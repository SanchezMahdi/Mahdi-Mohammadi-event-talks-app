# Google BigQuery Release Notes Explorer & Tweet Sharer

A modern, responsive web application built with **Python Flask** and **plain vanilla HTML, CSS, and JavaScript** that fetches, parses, and displays the official [Google Cloud BigQuery Release Notes Feed](https://docs.cloud.google.com/feeds/bigquery-release-notes.xml).

---

## ✨ Features

- **Live Atom XML Feed Ingestion**:
  - Automatically fetches and parses release notes from `https://docs.cloud.google.com/feeds/bigquery-release-notes.xml`.
  - Splits entries into individual, granular updates (e.g., *Feature*, *Change*, *Fixed*, *Deprecated*, *Security*).
  - Preserves hyperlinks (opening safely in new tabs) and code formatting.

- **One-Click Refresh with Animated Spinner**:
  - Dedicated refresh button with a smooth SVG spinner animation.
  - Fetches the latest updates dynamically without reloading the entire page.
  - In-memory cache with fallback to ensure fast loading and responsive browsing.

- **Select Any Update & Tweet About It**:
  - Click **"Select"** on any release update to highlight it and activate the selection bar.
  - Or click the **"Tweet"** button directly on any card.
  - Opens an interactive **Tweet Composer Modal**:
    - Auto-generates an engaging tweet draft with update type, date, summary, and official documentation anchor link.
    - Live **280-character counter** with circular visual progress indicator.
    - Quick-toggle hashtag buttons (`#BigQuery`, `#GoogleCloud`, `#DataEngineering`, `#SQL`, `#GCP`).
    - One-click **"Post on X / Tweet"** via Twitter Web Intent.
    - One-click **"Copy Text"** to clipboard.

- **Instant Search & Category Filtering**:
  - Search input with real-time filtering across titles, descriptions, and dates.
  - Category filter chips with dynamic item counts (*All*, *Feature*, *Change*, *Deprecated*, etc.).

---

## 🚀 Quick Start

### 1. Requirements

- Python 3.9+ (tested with Python 3.12)
- Dependencies listed in `requirements.txt`:
  - `Flask`
  - `requests`
  - `beautifulsoup4`

### 2. Run the Application

From the project root:

```bash
python3 app.py
```

Open your browser and navigate to:
👉 **[http://localhost:5001](http://localhost:5001)**

*(Note: Port 5001 is used to avoid conflict with macOS AirPlay Receiver on port 5000)*

---

## 📁 Project Structure

```
.
├── app.py                  # Flask backend: XML parsing, caching & REST API
├── requirements.txt        # Python package dependencies
├── templates/
│   └── index.html          # Plain vanilla HTML5 markup
├── static/
│   ├── css/
│   │   └── style.css       # Clean, modern CSS with Google Cloud aesthetic & spinner
│   └── js/
│       └── app.js          # Plain vanilla ES6 JavaScript (Fetch API, DOM, Web Intent)
└── README.md
```

---

## 🔌 API Endpoints

- `GET /`: Serves the single-page application.
- `GET /api/release-notes`: Returns parsed release notes as JSON.
- `GET /api/release-notes?refresh=true`: Forces a fresh re-fetch of the Google Cloud XML feed.
- `GET /api/health`: Health status endpoint.
