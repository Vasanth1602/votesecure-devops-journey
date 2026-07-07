FROM python:3.11-slim

WORKDIR /app

COPY requirements_BROKEN.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

CMD ["python", "server.py"]
