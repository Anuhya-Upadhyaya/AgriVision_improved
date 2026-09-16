/* =========================================================
   AGRIVISION APPLICATION
   Complete Frontend Controller
========================================================= */


/* =========================================================
   FIREBASE IMPORTS
========================================================= */

import { auth, db } from "./firebase-config.js";

import {

  createUserWithEmailAndPassword,

  signInWithEmailAndPassword,

  updateProfile,

  sendPasswordResetEmail,

  onAuthStateChanged,

  signOut

} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";


import {

  collection,

  addDoc,

  query,

  where,

  limit,

  getDocs,

  doc,

  setDoc,

  serverTimestamp

} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";



/* =========================================================
   AGRIVISION BACKEND CONFIGURATION
========================================================= */

const API_BASE_URL =
  (window.location.hostname === "localhost" ||
   window.location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:8000"
    : "https://agrivision-backend-bhp8.onrender.com";


const API_RETRY_COUNT = 3;


const API_RETRY_DELAY = 4000;



/* =========================================================
   DOM HELPER
========================================================= */

const $ = id => document.getElementById(id);



/* =========================================================
   GLOBAL APPLICATION STATE
========================================================= */

let currentUser = null;


let lastResult = null;


let backendHealth = null;


let districtsData = [];

const districtReferenceCache = new Map();


/* =========================================================
   CHART INSTANCES
========================================================= */

let nutrientChartInstance = null;

let causeChartInstance = null;

let trendChartInstance = null;

let dashboardNutrientChartInstance = null;

let environmentChartInstance = null;



/* =========================================================
   FEATURE VALIDATION RANGES
========================================================= */

const FEATURE_RANGES = {

  phosphorus: {

    min: 10,

    max: 120,

    name: "Phosphorus"

  },


  potassium: {

    min: 50,

    max: 300,

    name: "Potassium"

  },


  ph: {

    min: 5.5,

    max: 8.5,

    name: "Soil pH"

  },


  rainfall: {

    min: 200,

    max: 2000,

    name: "Annual Rainfall"

  },


  temperature: {

    min: 15,

    max: 40,

    name: "Average Temperature"

  },


  farmSize: {

    min: 0.1,

    max: 100000,

    name: "Farm Size"

  }

};



/* =========================================================
   PRIORITY COLORS
========================================================= */

const PRIORITY_COLOR = {

  High: "#c0392b",

  Medium: "#b8860b",

  Low: "#1f7a4d"

};


const IMPACT_COLOR = {

  High: "#e0574c",

  Medium: "#e0a63c",

  Low: "#4ba876"

};



/* =========================================================
   UTILITY FUNCTIONS
========================================================= */

function sleep(milliseconds) {

  return new Promise(resolve => {

    setTimeout(resolve, milliseconds);

  });

}



function escapeHtml(value) {

  return String(value ?? "").replace(

    /[&<>'"]/g,

    character => {

      const entities = {

        "&": "&amp;",

        "<": "&lt;",

        ">": "&gt;",

        "'": "&#39;",

        "\"": "&quot;"

      };

      return entities[character];

    }

  );

}



function formatNumber(value, decimals = 2) {

  const number = Number(value);


  if (!Number.isFinite(number)) {

    return "N/A";

  }


  return number.toFixed(decimals);

}



function formatDate(timestamp) {

  if (!timestamp) {

    return "Recent";

  }


  if (timestamp?.toDate) {

    return timestamp
      .toDate()
      .toLocaleString();

  }


  try {

    return new Date(timestamp)
      .toLocaleString();

  } catch {

    return "Recent";

  }

}



/* =========================================================
   MESSAGE MANAGEMENT
========================================================= */

function showMessage(
  element,
  text,
  isError = false
) {

  if (!element) return;


  element.textContent = text;


  element.classList.remove(

    "hidden",

    "error",

    "success"

  );


  element.classList.add(

    isError
      ? "error"
      : "success"

  );

}



function hideMessage(element) {

  if (!element) return;


  element.textContent = "";


  element.classList.add("hidden");


  element.classList.remove(

    "error",

    "success"

  );

}



/* =========================================================
   SAFE JSON PARSER
========================================================= */

async function getJsonResponse(response) {

  try {

    return await response.json();

  } catch {

    return null;

  }

}


function stringifyApiDetail(detail) {

  if (detail == null) return "";

  if (typeof detail === "string") return detail;

  if (detail.message) return String(detail.message);

  if (Array.isArray(detail.errors)) {

    return detail.errors.map(item => {

      const location = Array.isArray(item?.loc)

        ? item.loc.filter(Boolean).join(".")

        : "input";

      return `${location}: ${item?.msg || "Invalid value"}`;

    }).join(" | ");

  }

  try {

    return JSON.stringify(detail);

  } catch {

    return String(detail);

  }

}


function getApiErrorMessage(
  data,
  fallback = "Request failed."
) {

  if (!data) return fallback;

  if (data.message) return String(data.message);

  if (data.detail) {

    return stringifyApiDetail(data.detail) || fallback;

  }

  return stringifyApiDetail(data) || fallback;

}



/* =========================================================
   API FETCH WITH RETRY
========================================================= */

async function apiFetch(
  endpoint,
  options = {},
  retries = API_RETRY_COUNT
) {

  let lastError = null;


  for (

    let attempt = 1;

    attempt <= retries;

    attempt++

  ) {

    try {

      const response = await fetch(

        `${API_BASE_URL}${endpoint}`,

        options

      );


      if (response.ok) {

        return response;

      }


      if (

        response.status >= 500 &&

        attempt < retries

      ) {

        console.warn(

          `Server attempt ${attempt} failed. Retrying...`

        );


        await sleep(API_RETRY_DELAY);


        continue;

      }


      return response;


    } catch (error) {

      lastError = error;


      console.warn(

        `Network attempt ${attempt} failed.`,

        error

      );


      if (attempt < retries) {

        await sleep(API_RETRY_DELAY);

      }

    }

  }


  throw (

    lastError ||

    new Error(
      "Unable to connect to the AgriVision server."
    )

  );

}



/* =========================================================
   BACKEND HEALTH CHECK
========================================================= */

async function checkBackendHealth() {

  try {

    const response = await apiFetch(

      "/health",

      {},

      2

    );


    if (!response.ok) {

      backendHealth = null;

      return null;

    }


    const data =
      await getJsonResponse(response);


    backendHealth = data;


    console.log(
      "AgriVision backend status:",
      backendHealth
    );


    return data;


  } catch (error) {

    console.warn(
      "Backend health check failed:",
      error
    );


    backendHealth = null;


    return null;

  }

}



/* =========================================================
   STATE / DISTRICT CASCADING DROPDOWNS

   The manual-analysis form's District field is validated against
   the AgriVision dataset on the backend, and the backend exposes
   the state -> district mapping through GET /districts (returning
   one {state, district} record per dataset-backed district). Only
   states that actually have at least one matched district come
   back, so this never shows a state with an empty district list.

   State is populated once from that list; District is populated
   only after a state is chosen and is always rebuilt from scratch
   (clearing any previous selection) so it can never show a
   district that belongs to a different state.
========================================================= */

async function loadDistricts() {

  const stateSelect = $("state");
  const districtSelect = $("district");

  try {

    const response = await apiFetch(
      "/districts",
      {},
      2
    );

    const data = await getJsonResponse(response);

    if (!response.ok || !Array.isArray(data?.districts)) {

      throw new Error(
        getApiErrorMessage(
          data,
          "Could not load the state/district list."
        )
      );

    }

    districtsData = data.districts;

    const states = [
      ...new Set(
        districtsData.map(item => item.state)
      )
    ].sort(
      (a, b) => a.localeCompare(b)
    );

    if (stateSelect) {

      const previousValue = stateSelect.value;

      stateSelect.innerHTML =
        `<option value="">Select State / UT</option>` +
        states
          .map(
            state =>
              `<option value="${escapeHtml(state)}">${escapeHtml(state)}</option>`
          )
          .join("");

      if (previousValue && states.includes(previousValue)) {
        stateSelect.value = previousValue;
      }

    }

    if (districtSelect) {

      if (stateSelect?.value) {
        filterDistrictsByState(stateSelect.value);
      } else {
        districtSelect.innerHTML =
          `<option value="">Select State First</option>`;
        districtSelect.disabled = true;
      }

    }

  } catch (error) {

    console.warn(
      "Could not load districts:",
      error
    );

    if (districtSelect) {
      districtSelect.innerHTML =
        `<option value="">Districts unavailable — try again later</option>`;
      districtSelect.disabled = true;
    }

  }

}


function filterDistrictsByState(state) {

  const districtSelect = $("district");

  if (!districtSelect) return;

  // Any previously selected district is discarded here — the
  // dropdown is always rebuilt from an empty selection so a
  // district from another state can never remain selected.

  if (!state) {

    districtSelect.innerHTML =
      `<option value="">Select State First</option>`;

    districtSelect.disabled = true;

    $("districtInfo")?.classList.add("hidden");

    return;

  }

  const matches = districtsData
    .filter(item => item.state === state)
    .map(item => item.district)
    .sort((a, b) => a.localeCompare(b));

  districtSelect.innerHTML =
    `<option value="">Select ${escapeHtml(state)} District</option>` +
    matches
      .map(
        district =>
          `<option value="${escapeHtml(district)}">${escapeHtml(district)}</option>`
      )
      .join("");

  districtSelect.disabled = matches.length === 0;

  $("districtInfo")?.classList.add("hidden");

}


$("state")?.addEventListener(
  "change",
  () => {
    filterDistrictsByState($("state").value);
  }
);


/*
 * Shows the district's dataset-derived average Phosphorus/Potassium
 * (used as two of the model's features) so the farmer can see where
 * their entered values sit relative to their district before they
 * submit the form. Purely informational — /predict recalculates
 * these itself from the dataset rather than trusting anything sent
 * by the browser.
 */

$("district")?.addEventListener(
  "change",
  async () => {

    const infoBox = $("districtInfo");
    const district = $("district").value;

    if (!infoBox) return;

    if (!district) {
      infoBox.classList.add("hidden");
      infoBox.innerHTML = "";
      return;
    }

    infoBox.classList.remove("hidden");
    infoBox.textContent = "Loading district reference values...";

    try {

      const response = await apiFetch(
        `/district-summary/${encodeURIComponent(district)}`,
        {},
        2
      );

      const data = await getJsonResponse(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data));
      }

      infoBox.innerHTML =
        `District average — Phosphorus: <strong>${formatNumber(data.avg_phosphorus)}</strong> ` +
        `&middot; Potassium: <strong>${formatNumber(data.avg_potassium)}</strong>`;

    } catch (error) {

      console.warn("District summary unavailable:", error);

      infoBox.textContent =
        "District reference values are unavailable right now.";

    }

  }
);



/* =========================================================
   VIEW MANAGEMENT
========================================================= */

function showView(viewId) {

  document
    .querySelectorAll(".view")
    .forEach(view => {

      view.classList.add("hidden");

      view.classList.remove("active");

    });


  const targetView = $(viewId);


  if (targetView) {

    targetView.classList.remove("hidden");

    targetView.classList.add("active");

  }


  window.scrollTo({

    top: 0,

    behavior: "smooth"

  });


  if (viewId === "historyView") {

    loadHistory();

  }


  if (viewId === "visualizationView") {

    renderVisualizationDashboard();

  }


  if (viewId === "resultView") {

    renderTrendChart();

  }


  const activeNavKey =
    viewId.replace(/View$/, "");


  document
    .querySelectorAll(
      "#appNav [data-nav], #bottomNav [data-nav]"
    )
    .forEach(button => {

      button.classList.toggle(

        "active",

        button.dataset.nav === activeNavKey

      );

    });

}



/* =========================================================
   NAVIGATION EVENTS
========================================================= */

document
  .querySelectorAll("[data-nav]")
  .forEach(button => {

    button.addEventListener(

      "click",

      () => {

        const destination =
          button.dataset.nav;


        if (!destination) return;


        showView(
          `${destination}View`
        );

      }

    );

  });



/* =========================================================
   SERVICE WORKER
========================================================= */

if ("serviceWorker" in navigator) {

  window.addEventListener(

    "load",

    () => {

      navigator.serviceWorker

        .register("service-worker.js")

        .then(() => {

          console.log(
            "Service worker registered."
          );

        })

        .catch(error => {

          console.warn(
            "Service worker registration failed:",
            error
          );

        });

    }

  );

}



/* =========================================================
   GET STARTED (SPLASH -> LOGIN, OR SPLASH -> DASHBOARD
   FOR AN ALREADY-SIGNED-IN SESSION)
========================================================= */

$("getStartedButton")?.addEventListener(

  "click",

  () => {

    showView(
      currentUser
        ? "dashboardView"
        : "authView"
    );

  }

);



/* =========================================================
   AUTH TAB SWITCHING
========================================================= */

function switchAuthTab(tab) {

  document
    .querySelectorAll(".tab")
    .forEach(button => {

      button.classList.toggle(

        "active",

        button.dataset.authTab === tab

      );

    });


  $("loginForm")?.classList.toggle(

    "hidden",

    tab !== "login"

  );


  $("signupForm")?.classList.toggle(

    "hidden",

    tab !== "signup"

  );


  hideMessage($("authMessage"));

}


document
  .querySelectorAll("[data-auth-tab]")
  .forEach(button => {

    button.addEventListener(

      "click",

      () => {

        switchAuthTab(
          button.dataset.authTab
        );

      }

    );

  });



/* =========================================================
   FRIENDLY FIREBASE ERRORS
========================================================= */

function friendlyError(error) {

  const code =
    error?.code || "";


  const errors = {

    "auth/invalid-credential":
      "Incorrect email or password.",

    "auth/user-not-found":
      "No account was found with this email.",

    "auth/wrong-password":
      "Incorrect password.",

    "auth/email-already-in-use":
      "This email already has an account.",

    "auth/weak-password":
      "Password must contain at least 8 characters.",

    "auth/invalid-email":
      "Please enter a valid email address.",

    "auth/too-many-requests":
      "Too many attempts. Please wait before trying again."

  };


  return (

    errors[code] ||

    error?.message ||

    "Something went wrong. Please try again."

  );

}



/* =========================================================
   BACKEND ERROR HANDLING
========================================================= */

function backendErrorMessage(error) {

  const errorText =
    error?.message || "";


  if (

    errorText.includes("Failed to fetch") ||

    errorText.includes("NetworkError") ||

    errorText.includes("Unable to connect")

  ) {

    return (

      "Unable to connect to the AgriVision AI server. " +

      "The cloud server may be starting after inactivity. " +

      "Please wait a moment and try again."

    );

  }


  return (

    errorText ||

    "Soil analysis failed. Please try again."

  );

}



/* =========================================================
   LOGIN
========================================================= */

$("loginForm")?.addEventListener(

  "submit",

  async event => {

    event.preventDefault();


    hideMessage(
      $("authMessage")
    );


    const email =
      $("loginEmail").value.trim();


    const password =
      $("loginPassword").value;


    try {

      await signInWithEmailAndPassword(

        auth,

        email,

        password

      );


    } catch (error) {

      showMessage(

        $("authMessage"),

        friendlyError(error),

        true

      );

    }

  }

);



/* =========================================================
   SIGNUP
========================================================= */

$("signupForm")?.addEventListener(

  "submit",

  async event => {

    event.preventDefault();


    const name =
      $("signupName").value.trim();


    const email =
      $("signupEmail").value.trim();


    const password =
      $("signupPassword").value;


    const confirmPassword =
      $("signupConfirm").value;


    if (!name) {

      showMessage(

        $("authMessage"),

        "Please enter your full name.",

        true

      );

      return;

    }


    if (password.length < 8) {

      showMessage(

        $("authMessage"),

        "Password must contain at least 8 characters.",

        true

      );

      return;

    }


    if (password !== confirmPassword) {

      showMessage(

        $("authMessage"),

        "Passwords do not match.",

        true

      );

      return;

    }


    try {

      const credential =

        await createUserWithEmailAndPassword(

          auth,

          email,

          password

        );


      await updateProfile(

        credential.user,

        {

          displayName: name

        }

      );


      await setDoc(

        doc(

          db,

          "users",

          credential.user.uid

        ),

        {

          name,

          email,

          createdAt:
            serverTimestamp()

        },

        {

          merge: true

        }

      );


    } catch (error) {

      showMessage(

        $("authMessage"),

        friendlyError(error),

        true

      );

    }

  }

);



/* =========================================================
   PASSWORD RESET
========================================================= */

$("forgotPassword")?.addEventListener(

  "click",

  async () => {

    const email =
      $("loginEmail").value.trim();


    if (!email) {

      showMessage(

        $("authMessage"),

        "Enter your email address first.",

        true

      );

      return;

    }


    try {

      await sendPasswordResetEmail(

        auth,

        email

      );


      showMessage(

        $("authMessage"),

        "Password reset email sent successfully."

      );


    } catch (error) {

      showMessage(

        $("authMessage"),

        friendlyError(error),

        true

      );

    }

  }

);



/* =========================================================
   LOGOUT
========================================================= */

async function handleLogoutClick() {

  try {

    await signOut(auth);

  } catch (error) {

    console.error(

      "Logout failed:",

      error

    );

  }

}


$("logoutButton")?.addEventListener(

  "click",

  handleLogoutClick

);


$("profileLogoutButton")?.addEventListener(

  "click",

  handleLogoutClick

);



/* =========================================================
   MANUAL ANALYSIS — SUBMIT

   This is the single code path used for manual entry AND for the
   PDF/photo flows, since both of those just populate this same
   form (see applyExtractedFieldsToForm below) before the farmer
   presses "Analyze My Land". Values are re-validated here even
   though the browser's own number-input min/max already restrict
   most of them, because a user can still leave a field blank or
   paste an out-of-range value in some browsers.
========================================================= */

const ANALYSIS_LOADING_STAGES = [

  "🌱 Reading your land data...",

  "🔬 Analyzing soil conditions...",

  "🤖 Selecting the appropriate AI model...",

  "📊 Preparing your farm recommendation..."

];


function readAnalysisFormValues() {

  return {

    state: $("state")?.value || "",

    district: $("district")?.value || "",

    village: $("village")?.value.trim() || "",

    crop: $("crop")?.value || "",

    farm_size_acres: parseFloat($("farmSize")?.value),

    phosphorus: parseFloat($("phosphorus")?.value),

    potassium: parseFloat($("potassium")?.value),

    ph: parseFloat($("ph")?.value),

    rainfall: parseFloat($("rainfall")?.value),

    temperature: parseFloat($("temperature")?.value)

  };

}


function validateAnalysisForm(values) {

  if (!values.district) {
    return "Please select your district.";
  }

  if (!values.crop) {
    return "Please select your main crop.";
  }

  const numericChecks = [

    ["farm_size_acres", "Farm Size", FEATURE_RANGES.farmSize.min, FEATURE_RANGES.farmSize.max],
    ["phosphorus", FEATURE_RANGES.phosphorus.name, FEATURE_RANGES.phosphorus.min, FEATURE_RANGES.phosphorus.max],
    ["potassium", FEATURE_RANGES.potassium.name, FEATURE_RANGES.potassium.min, FEATURE_RANGES.potassium.max],
    ["ph", FEATURE_RANGES.ph.name, FEATURE_RANGES.ph.min, FEATURE_RANGES.ph.max],
    ["rainfall", FEATURE_RANGES.rainfall.name, FEATURE_RANGES.rainfall.min, FEATURE_RANGES.rainfall.max],
    ["temperature", FEATURE_RANGES.temperature.name, FEATURE_RANGES.temperature.min, FEATURE_RANGES.temperature.max]

  ];

  for (const [key, label, min, max] of numericChecks) {

    const value = values[key];

    if (!Number.isFinite(value)) {
      return `Please enter a valid number for ${label}.`;
    }

    if (value < min || value > max) {
      return `${label} must be between ${min} and ${max}.`;
    }

  }

  return null;

}


function showGlobalLoader(title) {

  const loader = $("globalLoader");

  if (!loader) return;

  if ($("loaderTitle")) {
    $("loaderTitle").textContent = title;
  }

  loader.classList.remove("hidden");

}


function hideGlobalLoader() {

  $("globalLoader")?.classList.add("hidden");

}


async function handleAnalysisSubmit(event) {

  event.preventDefault();

  hideMessage($("analysisMessage"));

  const values = readAnalysisFormValues();

  const validationError = validateAnalysisForm(values);

  if (validationError) {

    showMessage(
      $("analysisMessage"),
      validationError,
      true
    );

    return;

  }

  const button = $("predictButton");

  const originalButtonText = button?.textContent;

  if (button) {
    button.disabled = true;
    button.textContent = "🌱 Analyzing...";
  }

  showGlobalLoader("Analyzing Your Farm");

  let stageIndex = 0;

  if ($("loaderText")) {
    $("loaderText").textContent = ANALYSIS_LOADING_STAGES[0];
  }

  const stageTimer = setInterval(() => {

    stageIndex = (stageIndex + 1) % ANALYSIS_LOADING_STAGES.length;

    if ($("loaderText")) {
      $("loaderText").textContent = ANALYSIS_LOADING_STAGES[stageIndex];
    }

  }, 1500);

  try {

    const response = await apiFetch(

      "/predict",

      {

        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({

          state: values.state,
          district: values.district,
          village: values.village,
          crop: values.crop,
          farm_size_acres: values.farm_size_acres,
          phosphorus: values.phosphorus,
          potassium: values.potassium,
          ph: values.ph,
          rainfall: values.rainfall,
          temperature: values.temperature,
          model_choice: "auto"

        })

      }

    );

    const result = await getJsonResponse(response);

    if (!response.ok || !result?.success) {

      throw new Error(
        getApiErrorMessage(
          result,
          "Soil analysis failed. Please try again."
        )
      );

    }

    lastResult = result;

    renderAgreementBadge(result);
    renderFarmInformation(result);
    renderDistrictInformation(result);
    renderRecommendations(result);
    renderModelResults(result);
    renderNutrientChart(result);
    renderCauseChart(result.cause_effect);

    if ($("finalPrediction")) {

      $("finalPrediction").textContent =
        `${formatNumber(result.predicted_nitrogen)} kg/ha`;

    }

    if ($("resultStatus")) {

      $("resultStatus").textContent =
        `Nitrogen Status: ${result.status || "—"}`;

    }

    // Best-effort: history saving must never block the farmer from
    // seeing a prediction they already successfully received.
    await savePrediction(result);

    showView("resultView");

  } catch (error) {

    console.error("Prediction error:", error);

    showMessage(
      $("analysisMessage"),
      backendErrorMessage(error),
      true
    );

  } finally {

    clearInterval(stageTimer);

    hideGlobalLoader();

    if (button) {
      button.disabled = false;
      button.textContent = originalButtonText || "🌱 Analyze My Land";
    }

  }

}


$("analysisForm")?.addEventListener(
  "submit",
  handleAnalysisSubmit
);


$("newAnalysis")?.addEventListener(
  "click",
  () => {

    $("analysisForm")?.reset();

    filterDistrictsByState("");

    hideMessage($("analysisMessage"));

    showView("analysisView");

  }
);
/* =========================================================
   MODEL AGREEMENT
========================================================= */

function renderAgreementBadge(result) {

  const badge =
    $("agreementBadge");


  if (!badge) return;


  const agreement =

    result.model_agreement ||

    result.agreement;


  if (!agreement) {

    badge.classList.add(
      "hidden"
    );


    return;

  }


  badge.textContent =
    agreement;


  badge.classList.remove(
    "hidden"
  );

}



/* =========================================================
   FARM INFORMATION
========================================================= */

function renderFarmInformation(result) {

  const values =
    result.input_values || {};


  const farmInfo = [

    [
      "State / UT",
      values.state || "Not provided"
    ],


    [
      "District",
      values.district || "Not provided"
    ],


    [
      "Village / Area",
      values.village || "Not provided"
    ],


    [
      "Main Crop",
      values.crop || "Not provided"
    ],


    [
      "Farm Size",
      `${formatNumber(
        values.farm_size_acres
      )} Acres`
    ],


    [
      "Phosphorus",
      formatNumber(
        values.phosphorus
      )
    ],


    [
      "Potassium",
      formatNumber(
        values.potassium
      )
    ],


    [
      "Soil pH",
      formatNumber(
        values.ph
      )
    ],


    [
      "Annual Rainfall",
      `${formatNumber(
        values.rainfall
      )} mm`
    ],


    [
      "Average Temperature",
      `${formatNumber(
        values.temperature
      )} °C`
    ]

  ];


  $("resultFarm").innerHTML =

    farmInfo

      .map(([key, value]) => `

        <div>

          <span>
            ${escapeHtml(key)}
          </span>

          <strong>
            ${escapeHtml(value)}
          </strong>

        </div>

      `)

      .join("");

}



/* =========================================================
   DISTRICT REFERENCE INFORMATION
========================================================= */

function renderDistrictInformation(result) {

  const container =
    $("resultDistrict");


  if (!container) return;


  const districtReference =

    result.district_averages ||

    result.district_reference ||

    result.district_info ||

    {};


  const avgP =

    districtReference.phosphorus ??

    districtReference.avg_phosphorus ??

    result.avg_p_by_district;


  const avgK =

    districtReference.potassium ??

    districtReference.avg_potassium ??

    result.avg_k_by_district;


  if (

    avgP === undefined &&

    avgK === undefined

  ) {

    container.innerHTML = `

      <div>

        <span>
          District
        </span>

        <strong>

          ${escapeHtml(

            result.input_values?.district ||

            "Selected District"

          )}

        </strong>

      </div>

    `;


    return;

  }


  container.innerHTML = `

    <div>

      <span>
        Average Phosphorus
      </span>

      <strong>
        ${formatNumber(avgP)}
      </strong>

    </div>


    <div>

      <span>
        Average Potassium
      </span>

      <strong>
        ${formatNumber(avgK)}
      </strong>

    </div>

  `;

}



/* =========================================================
   RECOMMENDATIONS
========================================================= */

function renderRecommendations(result) {

  const container =
    $("resultRecommendations");


  if (!container) return;


  const recommendations =

    result.recommendations_detailed ||

    result.recommendations ||

    [

      {

        category:
          "Soil Recommendation",

        priority:
          "Medium",

        text:

          result.recommendation ||

          "No specific recommendation is available."

      }

    ];


  const normalizedRecommendations =

    Array.isArray(recommendations)

      ? recommendations

      : [

          {

            category:
              "Recommendation",

            priority:
              "Medium",

            text:
              String(recommendations)

          }

        ];


  container.innerHTML =

    normalizedRecommendations

      .map(recommendation => {

        const priority =

          recommendation.priority ||

          "Medium";


        const color =

          PRIORITY_COLOR[priority] ||

          PRIORITY_COLOR.Medium;


        return `

          <div

            class="reco-card"

            style="

              border-left-color:

              ${color};

            "

          >

            <div class="reco-head">

              <span class="reco-category">

                ${escapeHtml(

                  recommendation.category ||

                  "Recommendation"

                )}

              </span>


              <span

                class="reco-priority"

                style="color:${color}"

              >

                ${escapeHtml(priority)}

                priority

              </span>

            </div>


            <p>

              ${escapeHtml(

                recommendation.text ||

                recommendation.message ||

                ""

              )}

            </p>

          </div>

        `;

      })

      .join("");

}



/* =========================================================
   MODEL RESULTS
========================================================= */

function renderModelResults(result) {

  const container =
    $("modelResults");


  if (!container) return;


  const models =

    result.model_predictions ||

    result.models ||

    {};


  const entries =
    Object.entries(models);


  if (!entries.length) {

    container.innerHTML = `

      <p class="muted">

        The AgriVision ensemble generated the final prediction.

      </p>

    `;


    return;

  }


  container.innerHTML =

    entries

      .map(([model, value]) => `

        <div class="model-card">

          <span>

            ${escapeHtml(model)}

          </span>


          <strong>

            ${formatNumber(value)}

          </strong>

        </div>

      `)

      .join("");

}



/* =========================================================
   NUTRIENT CHART
========================================================= */

function renderNutrientChart(result) {

  if (typeof Chart === "undefined") {

    console.warn(
      "Chart.js is unavailable; chart skipped."
    );


    return;

  }


  const canvas =
    $("nutrientChart");


  if (!canvas) return;


  if (nutrientChartInstance) {

    nutrientChartInstance.destroy();

  }


  const values =
    result.input_values || {};


  nutrientChartInstance =

    new Chart(

      canvas.getContext("2d"),

      {

        type: "bar",


        data: {

          labels: [

            "Phosphorus",

            "Potassium",

            "Soil pH"

          ],


          datasets: [

            {

              label:
                "Your Soil Values",


              data: [

                Number(
                  values.phosphorus
                ) || 0,


                Number(
                  values.potassium
                ) || 0,


                Number(
                  values.ph
                ) || 0

              ],


              borderRadius: 8

            }

          ]

        },


        options: {

          responsive: true,


          maintainAspectRatio: false,


          plugins: {

            legend: {

              display: false

            }

          },


          scales: {

            y: {

              beginAtZero: true

            }

          }

        }

      }

    );

}



/* =========================================================
   CAUSE EFFECT CHART
========================================================= */

function renderCauseChart(causeEffect) {

  if (typeof Chart === "undefined") {

    console.warn(
      "Chart.js is unavailable; chart skipped."
    );


    return;

  }


  const canvas =
    $("causeChart");


  if (!canvas) return;


  if (causeChartInstance) {

    causeChartInstance.destroy();

    causeChartInstance = null;

  }


  const factors =

    causeEffect?.contributing_factors ||

    [];


  if (!factors.length) {

    return;

  }


  causeChartInstance =

    new Chart(

      canvas.getContext("2d"),

      {

        type: "bar",


        data: {

          labels:

            factors.map(
              factor => factor.factor
            ),


          datasets: [

            {

              label:
                "Relative Impact",


              data:

                factors.map(

                  factor =>

                    Number(
                      factor.value
                    ) || 0

                ),


              backgroundColor:

                factors.map(

                  factor =>

                    IMPACT_COLOR[
                      factor.impact
                    ]

                    ||

                    "#4ba876"

                ),


              borderRadius: 6

            }

          ]

        },


        options: {

          indexAxis: "y",


          responsive: true,


          maintainAspectRatio: false,


          plugins: {

            legend: {

              display: false

            }

          },


          scales: {

            x: {

              beginAtZero: true

            }

          }

        }

      }

    );

}



/* =========================================================
   SAVE PREDICTION TO FIRESTORE
========================================================= */

async function savePrediction(result) {

  if (!currentUser) return;


  const values =
    result.input_values || {};


  try {

    await addDoc(

      collection(

        db,

        "prediction_history"

      ),

      {

        userId:
          currentUser.uid,


        createdAt:
          serverTimestamp(),


        state:
          values.state || "",


        district:
          values.district || "",


        village:
          values.village || "",


        crop:
          values.crop || "",


        farmSize:
          values.farm_size_acres || null,


        phosphorus:
          values.phosphorus,


        potassium:
          values.potassium,


        ph:
          values.ph,


        rainfall:
          values.rainfall,


        temperature:
          values.temperature,


        predictedNitrogen:
          result.predicted_nitrogen,


        status:
          result.status ||

          "Analysis Complete",


        recommendation:
          result.recommendation ||

          "",


        modelPredictions:
          result.model_predictions ||

          {},


        modelAgreement:
          result.model_agreement ||

          ""

      }

    );


    console.log(
      "Prediction history saved."
    );


  } catch (error) {

    console.warn(

      "Could not save prediction history:",

      error

    );

  }

}



/* =========================================================
   GET USER HISTORY
========================================================= */

async function getUserHistory(
  maxRecords = 50
) {

  if (!currentUser) {

    return [];

  }


  const historyQuery =

    query(

      collection(

        db,

        "prediction_history"

      ),


      where(

        "userId",

        "==",

        currentUser.uid

      ),


      limit(
        maxRecords
      )

    );


  const snapshot =
    await getDocs(historyQuery);


  const records =

    snapshot.docs.map(
      document => ({

        id:
          document.id,

        ...document.data()

      })

    );


  records.sort(

    (a, b) => {

      const aTime =

        a.createdAt?.toMillis?.() ||

        0;


      const bTime =

        b.createdAt?.toMillis?.() ||

        0;


      return aTime - bTime;

    }

  );


  return records;

}



/* =========================================================
   LOAD HISTORY
========================================================= */

async function loadHistory() {

  if (!currentUser) return;


  const container =
    $("historyList");


  if (!container) return;


  container.innerHTML = `

    <p class="muted">

      Loading prediction history...

    </p>

  `;


  try {

    const records =
      await getUserHistory(50);


    const history =
      [...records].reverse();


    if (!history.length) {

      container.innerHTML = `

        <div class="empty">

          <span>
            🌱
          </span>


          <h3>
            No analyses yet
          </h3>


          <p>

            Complete your first soil analysis to begin

            building your farm intelligence history.

          </p>

        </div>

      `;


      return;

    }


    container.innerHTML =

      history

        .map(item => {

          const prediction =

            Number(
              item.predictedNitrogen
            );


          return `

            <article

              class="history-card"

              data-history-id="${escapeHtml(item.id)}"

            >

              <div>

                <strong>

                  ${escapeHtml(

                    item.crop ||

                    "Soil Analysis"

                  )}

                </strong>


                <span>

                  ${escapeHtml(

                    item.district ||

                    "District not specified"

                  )}

                </span>


                <span>

                  P: ${formatNumber(item.phosphorus)}

                  ·

                  K: ${formatNumber(item.potassium)}

                  ·

                  pH: ${formatNumber(item.ph)}

                </span>

              </div>


              <div class="history-value">

                <strong>

                  ${

                    Number.isFinite(prediction)

                      ? prediction.toFixed(2)

                      : "N/A"

                  }

                </strong>


                <span>

                  Predicted Nitrogen

                </span>

              </div>


              <small>

                ${escapeHtml(

                  formatDate(item.createdAt)

                )}

              </small>

            </article>

          `;

        })

        .join("");


  } catch (error) {

    console.error(

      "History loading error:",

      error

    );


    container.innerHTML = `

      <div class="empty">

        <h3>
          History unavailable
        </h3>


        <p>

          Unable to load your prediction history.

        </p>

      </div>

    `;

  }

}



/* =========================================================
   TREND CHART
========================================================= */

async function renderTrendChart() {

  if (typeof Chart === "undefined") {

    console.warn(
      "Chart.js is unavailable; trend chart skipped."
    );


    return;

  }


  const canvas =
    $("trendChart");


  const emptyMessage =
    $("trendEmpty");


  if (!canvas) return;


  try {

    const records =
      await getUserHistory(20);


    if (records.length < 2) {

      canvas.classList.add(
        "hidden"
      );


      emptyMessage?.classList.remove(
        "hidden"
      );


      return;

    }


    canvas.classList.remove(
      "hidden"
    );


    emptyMessage?.classList.add(
      "hidden"
    );


    if (trendChartInstance) {

      trendChartInstance.destroy();

    }


    trendChartInstance =

      new Chart(

        canvas.getContext("2d"),

        {

          type: "line",


          data: {

            labels:

              records.map(

                item =>

                  item.createdAt?.toDate

                    ?

                    item.createdAt

                      .toDate()

                      .toLocaleDateString()

                    :

                    "Recent"

              ),


            datasets: [

              {

                label:
                  "Predicted Nitrogen",


                data:

                  records.map(

                    item =>

                      Number(

                        item.predictedNitrogen

                      ) || 0

                  ),


                tension: 0.35,


                fill: false

              }

            ]

          },


          options: {

            responsive: true,


            maintainAspectRatio: false

          }

        }

      );


  } catch (error) {

    console.warn(

      "Trend chart error:",

      error

    );

  }

}
/* =========================================================
   VISUALIZATION DASHBOARD
========================================================= */

function renderVisualizationDashboard() {

  const empty =
    $("visualizationEmpty");


  const content =
    $("visualizationContent");


  if (!lastResult) {

    empty?.classList.remove(
      "hidden"
    );


    content?.classList.add(
      "hidden"
    );


    return;

  }


  empty?.classList.add(
    "hidden"
  );


  content?.classList.remove(
    "hidden"
  );


  const values =
    lastResult.input_values || {};


  $("vizPhosphorus").textContent =
    formatNumber(
      values.phosphorus
    );


  $("vizPotassium").textContent =
    formatNumber(
      values.potassium
    );


  $("vizPh").textContent =
    formatNumber(
      values.ph
    );


  $("vizNitrogen").textContent =

    formatNumber(

      lastResult.predicted_nitrogen

    );


  renderDashboardNutrientChart(
    values
  );


  renderEnvironmentChart(
    values
  );


  renderSoilHealthSummary(
    values
  );


  renderVisualizationFactors(
    lastResult
  );

}



/* =========================================================
   DASHBOARD NUTRIENT CHART
========================================================= */

function renderDashboardNutrientChart(
  values
) {

  if (typeof Chart === "undefined") {

    console.warn(
      "Chart.js is unavailable; chart skipped."
    );


    return;

  }


  const canvas =
    $("dashboardNutrientChart");


  if (!canvas) return;


  if (dashboardNutrientChartInstance) {

    dashboardNutrientChartInstance.destroy();

  }


  dashboardNutrientChartInstance =

    new Chart(

      canvas.getContext("2d"),

      {

        type: "bar",


        data: {

          labels: [

            "Phosphorus",

            "Potassium",

            "Soil pH"

          ],


          datasets: [

            {

              label:
                "Current Soil Values",


              data: [

                Number(
                  values.phosphorus
                ) || 0,


                Number(
                  values.potassium
                ) || 0,


                Number(
                  values.ph
                ) || 0

              ],


              borderRadius: 8

            }

          ]

        },


        options: {

          responsive: true,


          maintainAspectRatio: false,


          plugins: {

            legend: {

              display: false

            }

          }

        }

      }

    );

}



/* =========================================================
   ENVIRONMENT CHART
========================================================= */

function renderEnvironmentChart(
  values
) {

  if (typeof Chart === "undefined") {

    console.warn(
      "Chart.js is unavailable; chart skipped."
    );


    return;

  }


  const canvas =
    $("environmentChart");


  if (!canvas) return;


  if (environmentChartInstance) {

    environmentChartInstance.destroy();

  }


  environmentChartInstance =

    new Chart(

      canvas.getContext("2d"),

      {

        type: "bar",


        data: {

          labels: [

            "Rainfall (mm)",

            "Temperature (°C)"

          ],


          datasets: [

            {

              label:
                "Environmental Conditions",


              data: [

                Number(
                  values.rainfall
                ) || 0,


                Number(
                  values.temperature
                ) || 0

              ],


              borderRadius: 8

            }

          ]

        },


        options: {

          responsive: true,


          maintainAspectRatio: false,


          plugins: {

            legend: {

              display: false

            }

          }

        }

      }

    );

}



/* =========================================================
   SOIL HEALTH SUMMARY
========================================================= */

function renderSoilHealthSummary(
  values
) {

  const container =
    $("soilHealthSummary");


  if (!container) return;


  const checks = [

    [

      "Phosphorus",

      values.phosphorus,

      10,

      120

    ],


    [

      "Potassium",

      values.potassium,

      50,

      300

    ],


    [

      "Soil pH",

      values.ph,

      5.5,

      8.5

    ],


    [

      "Rainfall",

      values.rainfall,

      200,

      2000

    ],


    [

      "Temperature",

      values.temperature,

      15,

      40

    ]

  ];


  container.innerHTML =

    checks

      .map(

        ([

          name,

          value,

          min,

          max

        ]) => {

          const numericValue =
            Number(value);


          let status =
            "Within supported range";


          if (

            numericValue < min ||

            numericValue > max

          ) {

            status =
              "Outside supported range";

          }


          return `

            <div>

              <span>

                ${escapeHtml(name)}

              </span>


              <strong>

                ${formatNumber(value)}

              </strong>


              <small>

                ${escapeHtml(status)}

                · Expected: ${min} – ${max}

              </small>

            </div>

          `;

        }

      )

      .join("");

}



/* =========================================================
   KEY INFLUENCING FACTORS
========================================================= */

function renderVisualizationFactors(
  result
) {

  const container =
    $("visualizationFactors");


  if (!container) return;


  const factors =

    result.cause_effect

      ?.contributing_factors ||

    [];


  if (!factors.length) {

    container.innerHTML = `

      <p class="muted">

        The AgriVision ensemble evaluated all available

        soil and environmental features.

      </p>

    `;


    return;

  }


  container.innerHTML =

    factors

      .map(factor => `

        <div class="factor-item">

          <strong>

            ${escapeHtml(

              factor.factor

            )}

          </strong>


          <span>

            ${escapeHtml(

              factor.impact ||

              "Analyzed"

            )}

          </span>

        </div>

      `)

      .join("");

}



/* =========================================================
   FIREBASE AUTH STATE
========================================================= */

onAuthStateChanged(

  auth,

  async user => {

    currentUser = user;


    if (!user) {

      lastResult = null;


      $("appNav")?.classList.add(
        "hidden"
      );


      $("bottomNav")?.classList.add(
        "hidden"
      );


      /*
       * A visitor who hasn't pressed "Get Started" yet should stay
       * on the splash screen rather than being dropped straight
       * onto the login form the instant Firebase reports there's
       * no active session. Once they've moved past the splash
       * (getStartedButton, or a stale/expired session that lands
       * them back here from an authenticated view), it's safe to
       * show the login form directly.
       */

      const onSplash =
        !$("splashView")?.classList.contains("hidden");

      if (!onSplash) {

        showView(
          "authView"
        );

      }


      return;

    }


    $("appNav")?.classList.remove(
      "hidden"
    );


    $("bottomNav")?.classList.remove(
      "hidden"
    );


    if ($("profileName")) {

      $("profileName").textContent =

        user.displayName ||

        "Farmer";

    }


    if ($("profileEmail")) {

      $("profileEmail").textContent =

        user.email ||

        "—";

    }


    const welcomeName =
      $("welcomeName");


    if (welcomeName) {

      welcomeName.textContent =

        `Welcome, ${

          user.displayName ||

          "Farmer"

        }`;

    }


    showView(
      "dashboardView"
    );


    /*
     * Initialize backend resources.
     */

    checkBackendHealth();


    if (!districtsData.length) {

      loadDistricts();

    }

  }

);



/* =========================================================
   PDF / IMAGE / CAMERA SOIL DATA EXTRACTION

   All three input methods funnel into ONE place: the existing
   manual-input form + the existing /predict pipeline. Extraction
   only ever fills in fields it actually detected — anything it
   can't read is left blank for the farmer to enter, and nothing
   here fabricates a value.
========================================================= */

const CROP_OPTION_VALUES = () =>

  Array.from(

    $("crop")?.options || []

  ).map(

    option =>
      option.value

  );



/**
 * Push extracted fields into the existing manual-input form and
 * jump to the review/analysis screen. Values that don't match an
 * existing dropdown option (state, district, crop) are left for
 * the farmer to pick, and called out in the banner message.
 */

async function applyExtractedFieldsToForm(

  extractedFields,

  missingFields,

  sourceLabel

) {

  const unresolved = [];


  /*
   * Free-text / numeric fields can
   * be set directly.
   */

  const directFieldMap = {

    village:
      "village",


    farm_size_acres:
      "farmSize",


    phosphorus:
      "phosphorus",


    potassium:
      "potassium",


    ph:
      "ph",


    rainfall:
      "rainfall",


    temperature:
      "temperature"

  };


  for (

    const [key, inputId]

    of Object.entries(
      directFieldMap
    )

  ) {

    if (
      extractedFields[key] === undefined
    ) {

      continue;

    }


    const input =
      $(inputId);


    if (input) {

      input.value =
        extractedFields[key];

    }

  }


  /*
   * STATE
   *
   * Set the state first.
   *
   * The change event then populates
   * only that state's districts.
   */

  if (extractedFields.state) {

    const stateSelect =
      $("state");


    const match =

      Array.from(
        stateSelect?.options || []
      )

      .find(

        option =>

          option.value.toLowerCase() ===

          String(
            extractedFields.state
          ).toLowerCase()

      );


    if (match) {

      stateSelect.value =
        match.value;


      stateSelect.dispatchEvent(

        new Event(
          "change",
          {
            bubbles: true
          }
        )

      );


    } else {

      unresolved.push(
        "state"
      );

    }

  }


  /*
   * DISTRICT
   *
   * The district dropdown depends on
   * the selected state, so wait briefly
   * for its options to exist.
   */

  if (extractedFields.district) {

    if (!districtsData.length) {

      await loadDistricts();

    }


    const districtSelect =
      $("district");


    /*
     * If a state was extracted, filter
     * districts again before searching
     * for the extracted district.
     */

    if (extractedFields.state) {

      const stateSelect =
        $("state");


      if (stateSelect?.value) {

        filterDistrictsByState(
          stateSelect.value
        );

      }

    }


    const match =

      Array.from(
        districtSelect?.options || []
      )

      .find(

        option =>

          option.value.toLowerCase() ===

          String(
            extractedFields.district
          ).toLowerCase()

      );


    if (match) {

      districtSelect.value =
        match.value;


      districtSelect.dispatchEvent(

        new Event(
          "change"
        )

      );


    } else {

      unresolved.push(
        "district"
      );

    }

  }


  /*
   * CROP
   */

  if (extractedFields.crop) {

    const cropSelect =
      $("crop");


    const match =

      CROP_OPTION_VALUES()

        .find(

          value =>

            value.toLowerCase() ===

            String(
              extractedFields.crop
            ).toLowerCase()

        );


    if (match) {

      cropSelect.value =
        match;

    } else {

      unresolved.push(
        "crop"
      );

    }

  }


  const allMissing = [

    ...missingFields,

    ...unresolved

  ];


  showView(
    "analysisView"
  );


  hideMessage(
    $("analysisMessage")
  );


  if (allMissing.length) {

    showMessage(

      $("analysisMessage"),

      `Read from your ${sourceLabel}. Please fill in or double-check: ` +

      `${[...new Set(allMissing)].join(", ")}. Review everything below ` +

      `before analyzing.`,

      false

    );


  } else {

    showMessage(

      $("analysisMessage"),

      `All supported fields were read from your ${sourceLabel}. ` +

      `Please review them below before analyzing.`,

      false

    );

  }

}



/* =========================================================
   PDF SOIL REPORT
========================================================= */

$("soilReportFile")?.addEventListener(

  "change",

  () => {

    const file =
      $("soilReportFile").files?.[0];


    $("reportFileName").textContent =

      file
        ? file.name
        : "";


    $("processReportButton").disabled =
      !file;


    hideMessage(
      $("reportMessage")
    );

  }

);



$("processReportButton")?.addEventListener(

  "click",

  async () => {

    const file =
      $("soilReportFile").files?.[0];


    if (!file) {

      showMessage(

        $("reportMessage"),

        "Please choose a PDF file first.",

        true

      );


      return;

    }


    const button =
      $("processReportButton");


    button.disabled = true;


    button.textContent =
      "📖 Reading soil report...";


    hideMessage(
      $("reportMessage")
    );


    try {

      const formData =
        new FormData();


      formData.append(
        "file",
        file
      );


      const response =

        await apiFetch(

          "/extract/pdf",

          {
            method: "POST",
            body: formData
          }

        );


      const result =
        await getJsonResponse(
          response
        );


      if (!response.ok) {

        throw new Error(

          result?.detail?.message ||

          result?.detail ||

          "Could not read this report."

        );

      }


      await applyExtractedFieldsToForm(

        result.extracted_fields || {},

        result.missing_fields || [],

        "soil report"

      );


    } catch (error) {

      console.error(

        "PDF extraction error:",

        error

      );


      showMessage(

        $("reportMessage"),

        backendErrorMessage(error),

        true

      );


    } finally {

      button.disabled = false;


      button.textContent =
        "Process Report";

    }

  }

);



/* =========================================================
   IMAGE / CAMERA
========================================================= */

let selectedSoilImageFile = null;



function handleImageFileSelected(file) {

  selectedSoilImageFile =
    file || null;


  const preview =
    $("imagePreview");


  if (file) {

    preview.src =
      URL.createObjectURL(file);


    preview.classList.remove(
      "hidden"
    );


    $("retakeImageButton")
      .classList.remove(
        "hidden"
      );


    $("processImageButton").disabled =
      false;


  } else {

    preview.classList.add(
      "hidden"
    );


    $("retakeImageButton")
      .classList.add(
        "hidden"
      );


    $("processImageButton").disabled =
      true;

  }


  hideMessage(
    $("imageMessage")
  );

}



$("soilImageFile")?.addEventListener(

  "change",

  () =>

    handleImageFileSelected(

      $("soilImageFile").files?.[0]

    )

);



$("soilImageCameraFile")?.addEventListener(

  "change",

  () =>

    handleImageFileSelected(

      $("soilImageCameraFile").files?.[0]

    )

);



$("retakeImageButton")?.addEventListener(

  "click",

  () => {

    $("soilImageFile").value = "";

    $("soilImageCameraFile").value = "";


    handleImageFileSelected(
      null
    );

  }

);



$("processImageButton")?.addEventListener(

  "click",

  async () => {

    if (!selectedSoilImageFile) {

      showMessage(

        $("imageMessage"),

        "Please choose or take a photo first.",

        true

      );


      return;

    }


    const button =
      $("processImageButton");


    button.disabled = true;


    button.textContent =
      "🔍 Processing image...";


    hideMessage(
      $("imageMessage")
    );


    try {

      const formData =
        new FormData();


      formData.append(

        "file",

        selectedSoilImageFile

      );


      const response =

        await apiFetch(

          "/extract/image",

          {

            method: "POST",

            body: formData

          }

        );


      const result =
        await getJsonResponse(
          response
        );


      if (!response.ok) {

        throw new Error(

          result?.detail?.message ||

          result?.detail ||

          "Could not process this image."

        );

      }


      await applyExtractedFieldsToForm(

        result.extracted_fields || {},

        result.missing_fields || [],

        "photo"

      );


    } catch (error) {

      console.error(

        "Image extraction error:",

        error

      );


      showMessage(

        $("imageMessage"),

        backendErrorMessage(error),

        true

      );


    } finally {

      button.disabled = false;


      button.textContent =
        "Analyze Image";

    }

  }

);



/* =========================================================
   APPLICATION INITIALIZATION
========================================================= */

console.log(

  "🌱 AgriVision frontend initialized successfully."

);