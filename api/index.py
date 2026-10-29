from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import requests
from typing import List, Dict, Any
from datetime import datetime, timedelta, timezone

app = FastAPI(title="Gridbricks Energy Forecast API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"

def parse_time(time_str: str) -> str:
    """Standardizes ISO timestamps to ensure strict dict key matching for half-hourly intervals."""
    try:
        dt = datetime.fromisoformat(time_str.replace("Z", "+00:00")).astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:00Z")
    except Exception:
        return time_str

def fetch_elexon_data(endpoint: str, start_date: str, end_date: str) -> List[Dict[str, Any]]:
    url = f"{ELEXON_BASE_URL}/datasets/{endpoint}/stream"
    
    if endpoint == "FUELHH":
        params = {"settlementDateFrom": start_date, "settlementDateTo": end_date}
    else:  # WINDFOR
        params = {"publishDateTimeFrom": f"{start_date}T00:00:00Z", "publishDateTimeTo": f"{end_date}T23:59:59Z"}
        
    response = requests.get(url, params=params)
    
    if response.status_code != 200:
        raise HTTPException(
            status_code=502, 
            detail=f"Failed to fetch {endpoint}. Status: {response.status_code}"
        )
            
    res_json = response.json()
    return res_json.get("data", res_json) if isinstance(res_json, dict) else res_json

@app.get("/api/wind-data")
def get_wind_forecast_analysis(
    start_date: str = Query("2026-01-01", description="Start Date (YYYY-MM-DD)"),
    end_date: str = Query("2026-01-07", description="End Date (YYYY-MM-DD)")
):
    # Fetch Actuals
    actuals_data = fetch_elexon_data("FUELHH", start_date, end_date)
    
    # Fetch Forecasts (Offset by 1 day for Day-Ahead logic)
    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    forecast_start = (start_dt - timedelta(days=1)).strftime("%Y-%m-%d")
    forecasts_data = fetch_elexon_data("WINDFOR", forecast_start, end_date)
    
    # Process Actuals (FUELHH returns startTime at 30-min resolution)
    actuals_map = {}
    for record in actuals_data:
        if record.get("fuelType", "").upper() == "WIND":
            raw_start_time = record.get("startTime")
            generation = record.get("generation")
            if raw_start_time and generation is not None:
                actuals_map[parse_time(raw_start_time)] = generation

    # Process Forecasts
    forecasts_map = {}
    for record in forecasts_data:
        raw_start_time = record.get("startTime")
        publish_time = record.get("publishTime")
        generation = record.get("generation")
        
        if raw_start_time and generation is not None:
            std_time = parse_time(raw_start_time)
            if std_time not in forecasts_map:
                forecasts_map[std_time] = {"generation": generation, "publishTime": publish_time}
            else:
                current_latest = forecasts_map[std_time].get("publishTime")
                if publish_time and current_latest and publish_time > current_latest:
                    forecasts_map[std_time] = {"generation": generation, "publishTime": publish_time}

    combined_results = []
    
    # Elexon sometimes misses half-hourly forecast data points. 
    # To satisfy the 30-min resolution requirement, if an exact :30 forecast is missing, 
    # we carry forward the :00 forecast for that half-hour, just as a trader would.
    sorted_actual_times = sorted(actuals_map.keys())
    last_known_forecast = None
    
    for std_time in sorted_actual_times:
        actual_gen = actuals_map[std_time]
        
        # Check if we have an exact forecast for this 30-minute interval
        forecast = forecasts_map.get(std_time)
        
        if forecast:
            last_known_forecast = forecast
        else:
            # Carry forward the last known forecast if the :30 mark is missing in WINDFOR
            forecast = last_known_forecast
            
        if forecast:
            forecast_gen = forecast["generation"]
            error_margin = forecast_gen - actual_gen 
            percentage_error = (error_margin / actual_gen * 100) if actual_gen != 0 else 0
            
            combined_results.append({
                "startTime": std_time,
                "actualGeneration": actual_gen,
                "forecastGeneration": forecast_gen,
                "forecastPublishTime": forecast["publishTime"],
                "errorMw": round(error_margin, 2),
                "errorPercentage": round(percentage_error, 2)
            })

    return {
        "status": "success",
        "count": len(combined_results),
        "data": combined_results
    }