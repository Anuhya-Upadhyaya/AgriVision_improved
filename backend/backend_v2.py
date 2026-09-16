import io
import os
import re
import sys
from pathlib import Path
from typing import Dict, Optional, List, Tuple

import joblib
import pandas as pd

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator


# ============================================================
# SCIKIT-LEARN COMPATIBILITY FIX
# ============================================================

try:
    import sklearn._loss._loss as _sklearn_loss_impl

    sys.modules.setdefault(
        "_loss",
        _sklearn_loss_impl
    )

except ImportError:
    pass


# ============================================================
# OPTIONAL DOCUMENT/IMAGE EXTRACTION DEPENDENCIES
# ============================================================
# These power /extract/pdf and /extract/image. They are wrapped in
# try/except so a missing optional dependency degrades those two
# endpoints gracefully instead of crashing the whole API on startup
# (the rest of AgriVision — auth, dashboard, manual analysis,
# history, /predict — must keep working either way).

try:
    import pdfplumber
    PDF_EXTRACTION_AVAILABLE = True
except ImportError:
    PDF_EXTRACTION_AVAILABLE = False

try:
    import pytesseract
    from PIL import Image
    IMAGE_EXTRACTION_AVAILABLE = True
except ImportError:
    IMAGE_EXTRACTION_AVAILABLE = False


# ============================================================
# PATH CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

MODEL_DIR = BASE_DIR / "models"

DATASET_PATH = (
    BASE_DIR
    / "data"
    / "Crop and fertilizer dataset.csv"
)


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="AgriVision ML Backend",
    version="4.0.0",
    description=(
        "AI-powered soil intelligence API using "
        "11 machine-learning models and weighted ensemble prediction."
    )
)


# ============================================================
# CORS CONFIGURATION
# ============================================================

DEFAULT_ORIGINS = ",".join([
    "http://localhost",
    "http://localhost:5173",
    "http://127.0.0.1",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:8000",
    "https://agrivision-84da7.web.app",
    "https://agrivision-84da7.firebaseapp.com",
    "https://agrivision-application.web.app"
])


ALLOWED_ORIGINS = [

    origin.strip()

    for origin in os.environ.get(
        "ALLOWED_ORIGINS",
        DEFAULT_ORIGINS
    ).split(",")

    if origin.strip()
]


app.add_middleware(

    CORSMiddleware,

    allow_origins=ALLOWED_ORIGINS,

    allow_credentials=False,

    allow_methods=["*"],

    allow_headers=["*"]

)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError
):
    """
    Turn Pydantic validation failures into a single friendly
    message instead of a raw error array, so the frontend can
    display it directly (e.g. "Phosphorus must be between 10
    and 120.").
    """

    first_error = exc.errors()[0] if exc.errors() else {}

    message = first_error.get("msg", "Invalid input.")

    # Pydantic v2 prefixes custom ValueError messages with
    # "Value error, " — strip that so only our clean text remains.
    if message.startswith("Value error, "):
        message = message[len("Value error, "):]

    # Pydantic v2 puts the raw exception object in errors()[i]["ctx"]["error"]
    # for validators that raise ValueError. That raw object is not JSON
    # serializable, so json.dumps() inside JSONResponse would crash with an
    # unhandled 500 ("Internal Server Error", not JSON) instead of returning
    # this friendly 422 — jsonable_encoder() makes the whole errors list safe
    # to serialize (any object it can't convert becomes a plain dict/string
    # instead of raising).
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "message": message,
                "errors": jsonable_encoder(exc.errors())
            }
        }
    )


# ============================================================
# MODEL FEATURES
# ============================================================

FEATURE_NAMES = [

    "Phosphorus",
    "Potassium",
    "pH",
    "Rainfall",
    "Temperature",
    "Farm_Size_Acres",
    "Avg_P_by_District",
    "Avg_K_by_District"

]


# ============================================================
# MODEL PERFORMANCE VALUES
# ============================================================

MODEL_R2 = {

    "Extra Trees": 0.8218,
    "Random Forest": 0.8146,
    "XGBoost": 0.8093,
    "LightGBM": 0.8065,
    "Gradient Boosting": 0.8064,
    "CatBoost": 0.8060,
    "Decision Tree": 0.7925,
    "AdaBoost": 0.7493,
    "Lasso Regression": 0.7016,
    "Ridge Regression": 0.7016,
    "Linear Regression": 0.7016

}


# ============================================================
# MODEL FILES
# ============================================================

MODEL_FILES = {

    "Linear Regression":
        "linear_regression_tuned.pkl",

    "Ridge Regression":
        "ridge_model.pkl",

    "Lasso Regression":
        "lasso_model.pkl",

    "Decision Tree":
        "decision_tree_model.pkl",

    "Random Forest":
        "random_forest_soil_model.pkl",

    "Extra Trees":
        "extra_trees_soil_model.pkl",

    "Gradient Boosting":
        "gradient_boosting_tuned.pkl",

    "AdaBoost":
        "adaboost_model.pkl",

    "XGBoost":
        "xgboost_soil_model.pkl",

    "LightGBM":
        "lightgbm_tuned.pkl",

    "CatBoost":
        "catboost_model.pkl"

}


# ============================================================
# LOAD MODELS
# ============================================================

MODELS: Dict[str, object] = {}

LOAD_ERRORS: Dict[str, str] = {}


for model_name, filename in MODEL_FILES.items():

    model_path = MODEL_DIR / filename

    try:

        MODELS[model_name] = joblib.load(model_path)

        print(
            f"✓ Loaded model: {model_name}"
        )

    except Exception as exc:

        LOAD_ERRORS[model_name] = (
            f"{type(exc).__name__}: {exc}"
        )

        print(
            f"✗ Failed to load {model_name}: {exc}"
        )


if not MODELS:

    raise RuntimeError(
        "No ML models could be loaded."
    )


# ============================================================
# LOAD DATASET
# ============================================================

DATASET = None

DATASET_ERROR = None


try:

    DATASET = pd.read_csv(DATASET_PATH)

    if "District_Name" in DATASET.columns:

        DATASET["District_Name"] = (

            DATASET["District_Name"]
            .astype(str)
            .str.strip()

        )

    print("✓ Dataset loaded successfully")

except Exception as exc:

    DATASET_ERROR = (
        f"{type(exc).__name__}: {exc}"
    )

    print(
        f"✗ Dataset loading failed: {DATASET_ERROR}"
    )


# ============================================================
# REQUEST MODEL
# ============================================================

class FarmInput(BaseModel):

    # LOCATION

    state: Optional[str] = ""

    district: str = Field(
        min_length=1
    )

    village: Optional[str] = ""


    # FARM INFORMATION

    crop: str = Field(
        min_length=1
    )

    farm_size_acres: float = Field(
        gt=0
    )


    # SOIL DATA
    # NOTE: these bounds are enforced here on the backend (not only in the
    # browser) so a direct API call can never bypass them.

    phosphorus: float = Field(
        description="kg/ha, valid range 10-120"
    )

    potassium: float = Field(
        description="kg/ha, valid range 50-300"
    )

    ph: float = Field(
        description="valid range 5.5-8.5"
    )


    # ENVIRONMENT

    rainfall: float = Field(
        description="mm/year, valid range 200-2000"
    )

    temperature: float = Field(
        description="deg C, valid range 15-40"
    )


    # MODEL SELECTION

    model_choice: Optional[str] = "auto"


    # FARM PRACTICES

    irrigation_type: Optional[str] = None

    organic_farming: Optional[bool] = None


    # STRICT INPUT VALIDATION
    # Enforced here (in addition to the browser) so a direct API call
    # can never bypass these limits. Messages match the wording the
    # frontend uses so users see one consistent error either way.

    @field_validator("phosphorus")
    @classmethod
    def _validate_phosphorus(cls, value: float) -> float:
        if value < 10 or value > 120:
            raise ValueError(
                "Phosphorus must be between 10 and 120."
            )
        return value

    @field_validator("potassium")
    @classmethod
    def _validate_potassium(cls, value: float) -> float:
        if value < 50 or value > 300:
            raise ValueError(
                "Potassium must be between 50 and 300."
            )
        return value

    @field_validator("ph")
    @classmethod
    def _validate_ph(cls, value: float) -> float:
        if value < 5.5 or value > 8.5:
            raise ValueError(
                "pH must be between 5.5 and 8.5."
            )
        return value

    @field_validator("rainfall")
    @classmethod
    def _validate_rainfall(cls, value: float) -> float:
        if value < 200 or value > 2000:
            raise ValueError(
                "Rainfall must be between 200 and 2000."
            )
        return value

    @field_validator("temperature")
    @classmethod
    def _validate_temperature(cls, value: float) -> float:
        if value < 15 or value > 40:
            raise ValueError(
                "Temperature must be between 15 and 40."
            )
        return value


# ============================================================
# REFERENCE RANGES
# ============================================================

FACTOR_IDEAL_RANGES = {

    "Phosphorus": (20.0, 40.0),

    "Potassium": (110.0, 280.0),

    "pH": (6.0, 7.5),

    "Rainfall": (600.0, 1200.0),

    "Temperature": (20.0, 32.0)

}


# ============================================================
# FACTOR IMPACT
# ============================================================

def factor_impact(

    value: float,
    low: float,
    high: float

) -> Tuple[str, str]:

    span = max(
        high - low,
        1e-6
    )


    if low <= value <= high:

        return (
            "within_range",
            "Low"
        )


    if value < low:

        deviation = (
            (low - value)
            / span
        )

        direction = "below_range"

    else:

        deviation = (
            (value - high)
            / span
        )

        direction = "above_range"


    if deviation > 0.50:

        impact = "High"

    elif deviation > 0.20:

        impact = "Medium"

    else:

        impact = "Low"


    return direction, impact


# ============================================================
# CAUSE EFFECT ANALYSIS
# ============================================================

def build_cause_effect(
    data: FarmInput
):

    readings = {

        "Phosphorus":
            data.phosphorus,

        "Potassium":
            data.potassium,

        "pH":
            data.ph,

        "Rainfall":
            data.rainfall,

        "Temperature":
            data.temperature

    }


    factors = []


    for name, value in readings.items():

        low, high = (
            FACTOR_IDEAL_RANGES[name]
        )


        direction, impact = factor_impact(

            value,
            low,
            high

        )


        factors.append({

            "factor":
                name,

            "value":
                round(value, 2),

            "ideal_range":
                [low, high],

            "direction":
                direction,

            "impact":
                impact

        })


    priority = {

        "High": 0,
        "Medium": 1,
        "Low": 2

    }


    factors.sort(

        key=lambda item:
        priority[item["impact"]]

    )


    return {

        "contributing_factors":
            factors

    }


# ============================================================
# NITROGEN STATUS
# ============================================================

def nutrient_status(
    value: float
):

    if value < 50:

        return "Low"

    elif value < 100:

        return "Moderate"

    return "High"


# ============================================================
# DISTRICT LOOKUP
# ============================================================

def district_averages(
    district: str
):

    if DATASET is None:

        return None, None, "dataset_unavailable"


    if "District_Name" not in DATASET.columns:

        return None, None, "district_column_missing"


    normalized_district = (

        district
        .strip()
        .casefold()

    )


    matches = DATASET[

        DATASET["District_Name"]
        .astype(str)
        .str.strip()
        .str.casefold()

        ==

        normalized_district

    ]


    if matches.empty:

        return None, None, "district_not_found"


    avg_p = float(
        matches["Phosphorus"].mean()
    )


    avg_k = float(
        matches["Potassium"].mean()
    )


    return (

        avg_p,
        avg_k,
        "dataset"

    )


# ============================================================
# DOCUMENT / IMAGE FIELD EXTRACTION
# ============================================================
# Shared by /extract/pdf and /extract/image. Looks for the same
# fields the manual-input form collects, directly in whatever text
# was recovered from the file (PDF text layer, or OCR output for an
# image/photo of a report). A field is only ever returned if it was
# actually found in the text — nothing here invents or estimates a
# value, per the "never fabricate" requirement. The frontend still
# runs every extracted value through the normal review + validation
# step before /predict is ever called.

_EXTRACTION_PATTERNS: Dict[str, str] = {
    "phosphorus":
        r"phosphorus\D{0,20}?(\d+(?:\.\d+)?)",
    "potassium":
        r"potassium\D{0,20}?(\d+(?:\.\d+)?)",
    "ph":
        r"\bph\b\D{0,10}?(\d+(?:\.\d+)?)",
    "rainfall":
        r"rainfall\D{0,20}?(\d+(?:\.\d+)?)",
    "temperature":
        r"temperature\D{0,20}?(\d+(?:\.\d+)?)",
    "farm_size_acres":
        r"farm\s*size\D{0,20}?(\d+(?:\.\d+)?)",
}

_TEXT_FIELD_PATTERNS: Dict[str, str] = {
    "state":
        r"state\s*[:\-]\s*([A-Za-z .]+)",
    "district":
        r"district\s*[:\-]\s*([A-Za-z .]+)",
    "village":
        r"village\s*[:\-]\s*([A-Za-z .]+)",
    "crop":
        r"crop\s*[:\-]\s*([A-Za-z .]+)",
}

ALL_EXTRACTABLE_FIELDS = (
    list(_EXTRACTION_PATTERNS.keys())
    + list(_TEXT_FIELD_PATTERNS.keys())
)


def extract_fields_from_text(text: str) -> Dict[str, object]:
    """
    Scan raw text for the fields AgriVision's manual form collects.
    Returns only fields that were actually matched — missing fields
    are simply absent, never guessed.
    """

    if not text:
        return {}

    lowered = text.lower()
    found: Dict[str, object] = {}

    for field, pattern in _EXTRACTION_PATTERNS.items():
        match = re.search(pattern, lowered)
        if match:
            try:
                found[field] = float(match.group(1))
            except ValueError:
                continue

    for field, pattern in _TEXT_FIELD_PATTERNS.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = match.group(1).strip(" .\n\t")
            if value:
                found[field] = value

    return found


def build_extraction_response(
    found_fields: Dict[str, object],
    source: str,
    raw_text_length: int
) -> Dict[str, object]:

    missing = [
        field
        for field in ALL_EXTRACTABLE_FIELDS
        if field not in found_fields
    ]

    return {
        "success": True,
        "source": source,
        "extracted_fields": found_fields,
        "missing_fields": missing,
        "message": (
            "Some values could not be detected — please fill "
            "them in manually before analyzing."
            if missing else
            "All supported fields were detected. Please review "
            "them before analyzing."
        ) if raw_text_length > 0 else (
            "No readable text was found in this file. Please "
            "enter your soil values manually."
        )
    }


# ============================================================
# CREATE MODEL FEATURES
# ============================================================

def make_features(
    data: FarmInput
):

    avg_p, avg_k, status = (
        district_averages(
            data.district
        )
    )


    if status != "dataset":

        raise HTTPException(

            status_code=400,

            detail={

                "message":

                    f"District '{data.district}' was not found "
                    "in the AgriVision dataset.",

                "code":
                    "INVALID_DISTRICT"

            }

        )


    feature_values = [[

        data.phosphorus,

        data.potassium,

        data.ph,

        data.rainfall,

        data.temperature,

        data.farm_size_acres,

        avg_p,

        avg_k

    ]]


    dataframe = pd.DataFrame(

        feature_values,

        columns=FEATURE_NAMES

    )


    return (

        dataframe,

        avg_p,

        avg_k

    )


# ============================================================
# ENSEMBLE WEIGHTS
# ============================================================

def ensemble_weights(
    model_names
):

    raw = {

        name:

            max(
                MODEL_R2.get(name, 0),
                0
            )

        for name in model_names

    }


    total = sum(raw.values())


    if total <= 0:

        return {

            name:
                1 / len(raw)

            for name in raw

        }


    return {

        name:
            raw[name] / total

        for name in raw

    }


# ============================================================
# MODEL AGREEMENT
# ============================================================

def calculate_model_agreement(
    predictions: Dict[str, float]
):

    values = list(
        predictions.values()
    )


    count = len(values)


    if count < 2:

        return {

            "level": "N/A",

            "modelsUsed": count,

            "standardDeviation": 0,

            "coefficientOfVariation": None

        }


    mean_value = sum(values) / count


    variance = (

        sum(

            (value - mean_value) ** 2

            for value in values

        )

        / count

    )


    std = variance ** 0.5


    cv = (

        std / abs(mean_value)

        if mean_value != 0

        else None

    )


    if cv is None:

        level = "Low"

    elif cv < 0.05:

        level = "High"

    elif cv < 0.15:

        level = "Moderate"

    else:

        level = "Low"


    return {

        "level": level,

        "modelsUsed": count,

        "standardDeviation":
            round(std, 4),

        "coefficientOfVariation":

            round(cv, 4)

            if cv is not None

            else None

    }


# ============================================================
# DETAILED RECOMMENDATIONS
# ============================================================

def build_recommendations(

    status,
    cause_effect,
    crop,
    irrigation_type,
    organic_farming

):

    recommendations = []


    # NITROGEN MANAGEMENT

    if status == "Low":

        priority = "High"

    elif status == "Moderate":

        priority = "Medium"

    else:

        priority = "Medium"


    if organic_farming:

        nitrogen_text = (

            f"For {crop}, improve soil fertility using compost, "
            "farmyard manure, green manure, and suitable legumes. "
            "Confirm nutrient requirements using a soil test."

        )

    else:

        nitrogen_text = (

            f"For {crop}, follow a balanced nitrogen management plan. "
            "Avoid unnecessary fertilizer application and consider "
            "split application based on crop growth stage and soil testing."

        )


    recommendations.append({

        "category":
            "Nitrogen Management",

        "priority":
            priority,

        "text":
            nitrogen_text

    })


    # FACTOR RECOMMENDATIONS

    for factor in cause_effect[
        "contributing_factors"
    ]:

        if factor["direction"] == "within_range":

            continue


        name = factor["factor"]

        direction = factor["direction"]

        value = factor["value"]

        impact = factor["impact"]


        if name == "Phosphorus":

            if direction == "below_range":

                text = (
                    f"Phosphorus ({value}) is below the general "
                    "reference range. Review phosphorus requirements "
                    "using laboratory soil testing."
                )

            else:

                text = (
                    f"Phosphorus ({value}) is above the reference range. "
                    "Avoid unnecessary phosphate application."
                )


        elif name == "Potassium":

            if direction == "below_range":

                text = (
                    f"Potassium ({value}) is below the reference range. "
                    "Review potassium requirements before applying amendments."
                )

            else:

                text = (
                    f"Potassium ({value}) is above the reference range. "
                    "Avoid unnecessary potash application."
                )


        elif name == "pH":

            if direction == "below_range":

                text = (
                    f"Soil pH ({value}) is acidic compared with the "
                    "general reference range. Consider correction "
                    "only after laboratory testing."
                )

            else:

                text = (
                    f"Soil pH ({value}) is alkaline compared with the "
                    "general reference range. Seek local agronomic guidance."
                )


        elif name == "Rainfall":

            if direction == "below_range":

                text = (
                    f"Rainfall ({value} mm) is relatively low. "
                    "Consider water conservation and supplemental irrigation."
                )

            else:

                text = (
                    f"Rainfall ({value} mm) is relatively high. "
                    "Ensure good field drainage to reduce waterlogging."
                )


        elif name == "Temperature":

            text = (
                f"Temperature ({value}°C) is outside the general "
                "reference range. Monitor crop stress and irrigation needs."
            )


        else:

            continue


        recommendations.append({

            "category":
                f"{name} Management",

            "priority":
                impact,

            "text":
                text

        })


    recommendations.append({

        "category":
            "Crop Rotation",

        "priority":
            "Low",

        "text":

            f"Consider rotating {crop} with suitable legumes where "
            "agronomically appropriate to support long-term soil health."

    })


    priority_order = {

        "High": 0,
        "Medium": 1,
        "Low": 2

    }


    recommendations.sort(

        key=lambda item:

        priority_order.get(
            item["priority"],
            3
        )

    )


    return recommendations[:6]


# ============================================================
# ROOT ENDPOINT
# ============================================================

@app.get("/")
def root():

    return {

        "service":
            "AgriVision ML Backend",

        "version":
            "4.0.0",

        "status":
            "running",

        "models_loaded":
            len(MODELS)

    }


# ============================================================
# HEALTH ENDPOINT
# ============================================================

@app.get("/health")
def health():

    return {

        "status":

            "healthy"

            if len(MODELS) == len(MODEL_FILES)

            else "degraded",

        "models_loaded":
            len(MODELS),

        "models_expected":
            len(MODEL_FILES),

        "loaded_models":
            list(MODELS.keys()),

        "failed_models":
            LOAD_ERRORS,

        "dataset_loaded":
            DATASET is not None,

        "dataset_error":
            DATASET_ERROR

    }


# ============================================================
# MODELS ENDPOINT
# ============================================================

@app.get("/models")
def models():

    return {

        "models": [

            {

                "name":
                    name,

                "r2":
                    MODEL_R2[name],

                "loaded":
                    name in MODELS

            }

            for name in MODEL_FILES

        ]

    }


# ============================================================
# STATE → DISTRICT MAPPING
# ============================================================

STATE_DISTRICT_MAP = {
    "Andhra Pradesh": [],

    "Karnataka": [
        "Bagalakote",
        "Ballari",
        "Bangalore Rural",
        "Belagavi",
        "Bengaluru urban",
        "Bidar",
        "Chamarajanagar",
        "Chikkaballapura",
        "Chikkamagaluru",
        "Chitradurga",
        "Dakshina Kannada",
        "Davanagere",
        "Dharwad",
        "Gadag",
        "Hassan",
        "Haveri",
        "Kalaburagi",
        "Kodagu",
        "Kolar",
        "Koppal",
        "Mandya",
        "Mysuru",
        "Raichur",
        "Ramangara",
        "Shivamogga",
        "Tumakuru",
        "Udupi",
        "Uttara Kannada",
        "Vijayanagar",
        "Vijayapura",
        "Yadgir"
    ],

    "Kerala": [
        "Alappuzha",
        "Ernakulam",
        "Idukki",
        "Kannur",
        "Kasaragod",
        "Kollam",
        "Kottayam",
        "Kozhikode",
        "Malappuram",
        "Palakkad",
        "Pathanamthitta",
        "Thiruvananthapuram",
        "Thrissur",
        "Wayanad"
    ],

    "Maharashtra": [
        "Aurangabad",
        "Kolhapur",
        "Pune",
        "Sangli",
        "Satara",
        "Solapur"
    ],

    "Tamil Nadu": [
        "Ariyalur",
        "Chengalpattu",
        "Coimbatore",
        "Cuddalore",
        "Dharmapuri",
        "Dindigul",
        "Erode",
        "Kallakurichi",
        "Kanchipuram",
        "Kanniyakumari",
        "Karur",
        "Krishnagiri",
        "Madurai",
        "Mayiladuthurai",
        "Nagapattinam",
        "Namakkal",
        "Perambalur",
        "Pudukkottai",
        "Ramanathapuram",
        "Ranipet",
        "Salem",
        "Sivaganga",
        "Tenkasi",
        "Thanjavur",
        "The Nilgiris",
        "Theni",
        "Thiruvallur",
        "Thiruvarur",
        "Tiruchippalli",
        "Tirunelveli",
        "Tirupathur",
        "Tiruppur",
        "Tiruvannamalai",
        "Tuticorn",
        "Vellore",
        "Villupuram",
        "Virudhunagar"
    ],

    "Telangana": [],

    "Gujarat": [
        "Ahmedabad",
        "Amreli",
        "Anand",
        "Arvalli",
        "Banas Kantha",
        "Bharuch",
        "Bhavnagar",
        "Botad",
        "Chhotaudepur",
        "Dang",
        "Devbhumi Dwarka",
        "Dohad",
        "Gandhinagar",
        "Gir Somnath",
        "Jamnagar",
        "Junagadh",
        "Kachchh",
        "Kheda",
        "Mahesana",
        "Mahisagar",
        "Morbi",
        "Narmada",
        "Navsari",
        "Panch Mahals",
        "Patan",
        "Porbandar",
        "Rajkot",
        "Sabar Kantha",
        "Surat",
        "Surendranagar",
        "Tapi",
        "Vadodara",
        "Valsad"
    ],

    "Haryana": [
        "Ambala",
        "Bhiwani",
        "Charkhi Dadri",
        "Faridabad",
        "Fatehabad",
        "Gurugram",
        "Hisar",
        "Jhajjar",
        "Jind",
        "Kaithal",
        "Karnal",
        "Kurukshetra",
        "Mahendragarh",
        "Nuh",
        "Palwal",
        "Panchkula",
        "Panipat",
        "Rewari",
        "Rohtak",
        "Sirsa",
        "Sonipat",
        "Yamunanagar"
    ],

    "Bihar": [
        "Araria",
        "Arwal",
        "Aurangabad",
        "Banka",
        "Begusarai",
        "Bhagalpur",
        "Bhojpur",
        "Buxar",
        "Darbhanga",
        "East Champaran",
        "Gaya",
        "Gopalganj",
        "Jamui",
        "Jehanabad",
        "Kaimur",
        "Katihar",
        "Khagaria",
        "Kishanganj",
        "Lakhisarai",
        "Madhepura",
        "Madhubani",
        "Munger",
        "Muzaffarpur",
        "Nalanda",
        "Nawada",
        "Patna",
        "Purnia",
        "Rohtas",
        "Saharsa",
        "Samastipur",
        "Saran",
        "Sheikhpura",
        "Sheohar",
        "Sitamarhi",
        "Siwan",
        "Supaul",
        "Vaishali",
        "West Champaran"
    ],

    "Goa": [
        "North Goa",
        "South Goa"
    ]
}


# ============================================================
# DISTRICTS ENDPOINT
# ============================================================

@app.get("/districts")
def districts():

    if DATASET is None:
        raise HTTPException(
            status_code=500,
            detail="Dataset unavailable."
        )

    if "District_Name" not in DATASET.columns:
        raise HTTPException(
            status_code=500,
            detail="District column unavailable."
        )

    dataset_districts = set(
        DATASET["District_Name"]
        .dropna()
        .astype(str)
        .str.strip()
        .unique()
    )

    result = []

    for state, district_list in STATE_DISTRICT_MAP.items():

        for district in district_list:

            if district in dataset_districts:

                result.append({
                    "state": state,
                    "district": district
                })

    result.sort(
        key=lambda item: (
            item["state"].lower(),
            item["district"].lower()
        )
    )

    return {
        "districts": result,
        "count": len(result)
    }
# ============================================================
# DISTRICT SUMMARY
# ============================================================

@app.get("/district-summary/{district}")
def district_summary(
    district: str
):

    avg_p, avg_k, status = (
        district_averages(district)
    )


    if status != "dataset":

        raise HTTPException(

            status_code=404,

            detail={
                "message":
                    f"District '{district}' was not found."
            }

        )


    return {

        "district":
            district,

        "avg_phosphorus":
            round(avg_p, 4),

        "avg_potassium":
            round(avg_k, 4)

    }


# ============================================================
# PREDICTION ENDPOINT
# ============================================================

@app.post("/predict")
def predict(
    data: FarmInput
):

    # CREATE FEATURES

    input_dataframe, avg_p, avg_k = (

        make_features(data)

    )


    # MODEL SELECTION

    requested_model = (

        data.model_choice
        or "auto"

    ).strip()


    if requested_model.lower() in {

        "auto",
        "ensemble",
        "all"

    }:

        selected_models = list(
            MODELS.keys()
        )

        selection_mode = (
            "weighted_ensemble"
        )

    else:

        if requested_model not in MODELS:

            raise HTTPException(

                status_code=400,

                detail={

                    "message":
                        f"Unknown model: {requested_model}",

                    "available_models":
                        list(MODELS.keys())

                }

            )


        selected_models = [
            requested_model
        ]

        selection_mode = (
            "single_model"
        )


    # RUN PREDICTIONS

    predictions = {}

    prediction_errors = {}


    for model_name in selected_models:

        try:

            value = (

                MODELS[model_name]
                .predict(input_dataframe)[0]

            )


            predictions[model_name] = float(
                value
            )


        except Exception as exc:

            prediction_errors[model_name] = (

                f"{type(exc).__name__}: {exc}"

            )


    if not predictions:

        raise HTTPException(

            status_code=500,

            detail={

                "message":
                    "All selected models failed.",

                "errors":
                    prediction_errors

            }

        )


    # ENSEMBLE WEIGHTS

    weights = ensemble_weights(
        predictions.keys()
    )


    # FINAL PREDICTION

    if len(predictions) == 1:

        final_prediction = next(
            iter(predictions.values())
        )

    else:

        final_prediction = sum(

            predictions[name]
            * weights[name]

            for name in predictions

        )


    # STATUS

    status = nutrient_status(
        final_prediction
    )


    # AGREEMENT

    agreement = calculate_model_agreement(
        predictions
    )


    # CAUSE EFFECT

    cause_effect = build_cause_effect(
        data
    )


    # RECOMMENDATIONS

    recommendations = build_recommendations(

        status,

        cause_effect,

        data.crop,

        data.irrigation_type,

        data.organic_farming

    )


    # FINAL RESPONSE

    return {

        "success": True,


        # LOCATION

        "state":
            data.state,

        "district":
            data.district,

        "village":
            data.village,


        # FARM

        "crop":
            data.crop,

        "farm_size_acres":
            data.farm_size_acres,

        "irrigation_type":
            data.irrigation_type,

        "organic_farming":
            data.organic_farming,


        # PREDICTION

        "predicted_nitrogen":
            round(final_prediction, 4),

        "status":
            status,

        "recommendation":

            (
                "Use the detailed recommendations below and confirm "
                "fertilizer decisions with laboratory soil testing."
            ),


        # MODEL INFORMATION

        "selected_model":

            (
                "Weighted Ensemble"

                if len(predictions) > 1

                else next(iter(predictions))
            ),

        "selection_mode":
            selection_mode,

        "model_predictions": {

            name:
                round(value, 4)

            for name, value in predictions.items()

        },

        "model_weights": {

            name:
                round(weights[name], 6)

            for name in predictions

        },

        "models_used":
            list(predictions.keys()),

        "models_used_count":
            len(predictions),

        "model_errors":
            prediction_errors,

        "model_agreement":
            agreement,


        # DISTRICT DATA

        "district_averages": {

            "phosphorus":
                round(avg_p, 4),

            "potassium":
                round(avg_k, 4),

            "source":
                "dataset"

        },


        # INPUT VALUES

        "input_values": {

            "phosphorus":
                data.phosphorus,

            "potassium":
                data.potassium,

            "ph":
                data.ph,

            "rainfall":
                data.rainfall,

            "temperature":
                data.temperature,

            "farm_size_acres":
                data.farm_size_acres

        },


        # ANALYSIS

        "cause_effect":
            cause_effect,

        "recommendations_detailed":
            recommendations,


        # METADATA

        "analysis_metadata": {

            "backend_version":
                "4.0.0",

            "ensemble_method":
                "R2-weighted ensemble",

            "target_variable":
                "Nitrogen"

        }

    }

# ============================================================
# PDF SOIL REPORT EXTRACTION
# ============================================================

@app.post("/extract/pdf")
async def extract_pdf(file: UploadFile = File(...)):

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Please upload a PDF file."
            }
        )

    if not PDF_EXTRACTION_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail={
                "message": (
                    "PDF processing is temporarily unavailable. "
                    "Please use manual input instead."
                )
            }
        )

    raw_bytes = await file.read()

    # 15 MB upload limit
    if len(raw_bytes) > 15 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "File is too large. Please upload a PDF under 15MB."
            }
        )

    try:
        text_parts: List[str] = []

        with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                text_parts.append(page_text)

        full_text = "\n".join(text_parts)

    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": (
                    "This PDF could not be read. It may be scanned, "
                    "corrupted, or password-protected. Please try a "
                    "different file or use manual input."
                ),
                "error": f"{type(exc).__name__}: {exc}"
            }
        )

    found_fields = extract_fields_from_text(full_text)

    return build_extraction_response(
        found_fields,
        source="pdf",
        raw_text_length=len(full_text.strip())
    )


# ============================================================
# IMAGE SOIL REPORT / PHOTO EXTRACTION
# ============================================================

@app.post("/extract/image")
async def extract_image(file: UploadFile = File(...)):

    allowed_types = {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp"
    }

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail={
                "message": (
                    "Please upload a JPG, PNG, or WEBP image."
                )
            }
        )

    if not IMAGE_EXTRACTION_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail={
                "message": (
                    "Image processing is temporarily unavailable. "
                    "Please use manual input instead."
                )
            }
        )

    raw_bytes = await file.read()

    if len(raw_bytes) > 15 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "File is too large. Please upload an image under 15MB."
            }
        )

    try:
        image = Image.open(io.BytesIO(raw_bytes))
        image = image.convert("L")  # grayscale improves OCR accuracy
        extracted_text = pytesseract.image_to_string(image)

    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": (
                    "This image could not be processed. Please try "
                    "another photo or use manual input."
                ),
                "error": f"{type(exc).__name__}: {exc}"
            }
        )

    found_fields = extract_fields_from_text(extracted_text)

    # A plain photo of soil/farmland (not a report) will legitimately
    # produce little or no readable text — that is expected, and we
    # never fabricate numeric values to compensate. The response just
    # tells the user what (if anything) was found.
    return build_extraction_response(
        found_fields,
        source="image",
        raw_text_length=len(extracted_text.strip())
    )
