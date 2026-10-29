# UK Day-Ahead Wind Procurement Dashboard

A full-stack operational intelligence dashboard built for UK energy utility traders to evaluate the accuracy of national wind generation forecasts (`WINDFOR`) against actual metered generation (`FUELHH`) on the day-ahead wholesale market. 

## 🌐 Live Application
The production application is deployed serverlessly via Vercel and is accessible here: 
**[INSERT YOUR VERCEL LINK HERE]**

## 🏗️ Architecture & Tech Stack
- **Frontend UI:** React, Vite, Recharts
- **Backend API:** Python, FastAPI, Uvicorn, Requests
- **Data Source:** Elexon BMRS API (`v1/datasets/FUELHH/stream` and `WINDFOR`)
- **Infrastructure:** Docker (Local Development/Review) & Vercel Serverless Functions (Production)

## 📊 Key Engineering Decisions
1. **The 30-Minute Settlement Resolution:** The UK wholesale market settles in 30-minute blocks (48 periods/day). The `index.py` backend standardizes inconsistent ISO timestamps between the Elexon `WINDFOR` and `FUELHH` streams, guaranteeing that all 336 half-hourly intervals across a 7-day period are mapped accurately using $O(1)$ dictionary lookups. 
2. **Day-Ahead Alignment:** The backend automatically offsets the `WINDFOR` fetch logic by $T-1$ days to accurately simulate the data available to a trader making procurement decisions prior to the delivery day.
3. **Quantitative Intelligence:** The React frontend state calculates Mean Absolute Error (MAE), Mean Absolute Percentage Error (MAPE), and the P95 Reserve Buffer dynamically, turning raw timeseries data into actionable thermal hedging guidance.

## 🚀 How to Run Locally (Docker)
This repository is fully containerized for seamless technical review and local development. 

**Prerequisites:** You must have [Docker](https://docs.docker.com/get-docker/) installed and running on your machine.

1. Clone this repository and navigate to the root directory.
2. Build and start the containers using Docker Compose:
   ```bash
   docker compose up --build



🤖 AI Assistance Disclosure
In accordance with the challenge guidelines, I acknowledge the use of Large Language Models (LLMs) to augment the development process. Specifically, AI tools were utilized to accelerate boilerplate scaffolding, optimize the CSS grid layouts for the dark-mode interface, and quickly construct the initial Recharts SVG gradient definitions, allowing me to focus on the core business logic, API alignment, and architectural design.


├── api/
│   ├── index.py           # FastAPI backend logic (Fetches, aligns, and calculates Elexon telemetry)
│   └── requirements.txt   # Python dependencies generated via `uv`
├── src/
│   ├── App.jsx            # Main React Dashboard Component & Client-Side Logic
│   ├── App.css            # Custom CSS for the Dark Mode Trading Interface
│   └── main.jsx           # React Entry Point
├── public/                # Static assets
├── Dockerfile             # Containerizes the Python FastAPI backend
├── docker-compose.yml     # Orchestrates the local React + Python multi-container environment
├── vercel.json            # Configuration for Vercel Serverless routing
├── vite.config.js         # Vite configuration with local proxy routing
└── package.json           # Node.js dependencies and scripts