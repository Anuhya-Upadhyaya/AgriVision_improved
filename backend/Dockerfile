FROM python:3.11-slim

WORKDIR /app

# libgomp1 is required by LightGBM.
# tesseract-ocr is required by pytesseract for /extract/image.
RUN apt-get update && apt-get install -y \
    libgomp1 \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "uvicorn backend_v2:app --host 0.0.0.0 --port ${PORT}"]