# GPS Tracking & Geofencing

## Wiring (XIAO ESP32-C3)
GPS TX -> D7 / GPIO20 (ESP32 RX)  
GPS RX -> D6 / GPIO21 (ESP32 TX)  
GPS GND -> GND  
GPS VCC -> GPS breakout rated supply. Do not feed 5V logic into ESP32 GPIO.

## Start dashboard on Windows
Open this folder in VS Code terminal:
```powershell
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
python app.py
```
Open http://127.0.0.1:5000 on your laptop.

## Connect the ESP32
Run `ipconfig`; note the Wi-Fi adapter IPv4 address (example 192.168.1.25).
In firmware/xiao_esp32c3_gps.ino edit WIFI_SSID, WIFI_PASSWORD and API_URL using that laptop IP.
DEVICE_API_KEY must match API_KEY in app.py; both default to change-this-device-key for local testing.
Install Arduino libraries TinyGPSPlus (Mikal Hart) and ArduinoJson (Benoit Blanchon, 7.x).
Select ESP32C3 Dev Module (or XIAO_ESP32C3 if available), correct COM port, upload. Serial Monitor 115200.
Keep GPS outdoors/near open sky for satellite fix.

## Troubleshooting
HTTP 201 = location received. HTTP 401 = API key mismatch.
Connection refused/failed = check laptop IP, same Wi-Fi, Flask still running and Windows Firewall private-network permission.
Map tiles need browser internet. This is local-LAN starter code, not public cloud hosting. Do not port-forward the Flask development server.
Geofence zones are stored and drawn; the location API returns inside/outside status. SMS/push alerts and cloud hosting are not included.
