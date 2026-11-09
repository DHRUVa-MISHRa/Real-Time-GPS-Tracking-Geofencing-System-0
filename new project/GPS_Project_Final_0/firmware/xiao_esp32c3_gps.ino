
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>

// ==========================================
// XIAO ESP32-C3 + NEO-6M GPS TRACKER
// GPS + WIFI + GEOFENCE + BUZZER
// ==========================================

// GPS CONNECTION
#define GPS_RX_PIN 20       // D7 - GPIO20
#define GPS_TX_PIN 21       // D6 - GPIO21
#define GPS_BAUD 9600

HardwareSerial gpsSerial(1);
TinyGPSPlus gps;

// BUZZER CONNECTION
#define BUZZER_PIN 4        // D2 - GPIO4
#define BUZZER_ACTIVE_LEVEL HIGH

// ==========================================
// WIFI CONFIGURATION
// ==========================================

const char* WIFI_SSID = "Dhruv";
const char* WIFI_PASSWORD = "1234567890";

// ==========================================
// FLASK SERVER CONFIGURATION
// ==========================================

// Laptop IPv4 address
const char* API_URL =
  "http://172.28.195.225:5000/api/location";

// Must match app.py API key
const char* DEVICE_API_KEY = "change-this-device-key";

const char* DEVICE_ID = "xiao-gps-01";

// ==========================================
// GEOFENCE CONFIGURATION
// ==========================================

const double HOME_LATITUDE = 29.857022;
const double HOME_LONGITUDE = 77.916778;

const double GEOFENCE_RADIUS = 100.0;

// ==========================================
// TIMING CONFIGURATION
// ==========================================

const unsigned long SEND_INTERVAL = 10000;
const unsigned long WIFI_RETRY_INTERVAL = 10000;
const unsigned long GPS_TIMEOUT = 5000;
const unsigned long STATUS_INTERVAL = 3000;

unsigned long lastSendTime = 0;
unsigned long lastWiFiAttempt = 0;
unsigned long lastStatusTime = 0;

bool outsideZone = false;
bool geofenceKnown = false;

// ==========================================
// BUZZER CONTROL
// ==========================================

void buzzerOn() {
  digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_LEVEL);
}

void buzzerOff() {
  digitalWrite(BUZZER_PIN,
    BUZZER_ACTIVE_LEVEL == HIGH ? LOW : HIGH);
}

void updateBuzzer() {

  if (!geofenceKnown || !outsideZone) {
    buzzerOff();
    return;
  }

  // Beep pattern: 300ms ON, 700ms OFF
  unsigned long cycleTime = millis() % 1000;

  if (cycleTime < 300) {
    buzzerOn();
  } else {
    buzzerOff();
  }
}

// ==========================================
// WIFI CONNECTION
// ==========================================

void connectWiFi() {

  Serial.println("Connecting to WiFi...");

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  lastWiFiAttempt = millis();
}

void maintainWiFi() {

  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (millis() - lastWiFiAttempt >= WIFI_RETRY_INTERVAL) {

    Serial.println("Reconnecting WiFi...");

    WiFi.reconnect();

    lastWiFiAttempt = millis();
  }
}

// ==========================================
// GPS GEOFENCE CALCULATION
// ==========================================

void checkGeofence() {

  if (!gps.location.isValid() ||
      gps.location.age() > GPS_TIMEOUT) {

    geofenceKnown = false;
    outsideZone = false;
    buzzerOff();

    return;
  }

  double latitude = gps.location.lat();
  double longitude = gps.location.lng();

  double distance = TinyGPSPlus::distanceBetween(
    latitude,
    longitude,
    HOME_LATITUDE,
    HOME_LONGITUDE
  );

  bool previousStatus = outsideZone;
  bool wasKnown = geofenceKnown;

  outsideZone = (distance > GEOFENCE_RADIUS);
  geofenceKnown = true;

  // Print only when status changes
  if (!wasKnown || previousStatus != outsideZone) {

    Serial.println();
    Serial.println("======= GEOFENCE ALERT =======");

    Serial.print("Distance from Home: ");
    Serial.print(distance, 2);
    Serial.println(" meters");

    if (outsideZone) {
      Serial.println("WARNING: OUTSIDE SAFE ZONE!");
      Serial.println("BUZZER ALERT ACTIVATED!");
    } else {
      Serial.println("STATUS: IN ZONE");
      Serial.println("BUZZER OFF");
    }

    Serial.println("==============================");
  }
}

// ==========================================
// GPS STATUS MONITORING
// ==========================================

void printGPSStatus() {

  Serial.println();
  Serial.println("======= GPS STATUS =======");

  Serial.print("Characters Processed: ");
  Serial.println(gps.charsProcessed());

  Serial.print("Satellites: ");

  if (gps.satellites.isValid()) {
    Serial.println(gps.satellites.value());
  } else {
    Serial.println("Not Available");
  }

  if (gps.location.isValid() &&
      gps.location.age() <= GPS_TIMEOUT) {

    Serial.print("Latitude: ");
    Serial.println(gps.location.lat(), 6);

    Serial.print("Longitude: ");
    Serial.println(gps.location.lng(), 6);

    Serial.print("GPS Age (ms): ");
    Serial.println(gps.location.age());

    double distance = TinyGPSPlus::distanceBetween(
      gps.location.lat(),
      gps.location.lng(),
      HOME_LATITUDE,
      HOME_LONGITUDE
    );

    Serial.print("Distance from Home: ");
    Serial.print(distance, 2);
    Serial.println(" meters");

    Serial.print("Geofence Status: ");
    Serial.println(outsideZone ? "OUTSIDE" : "IN ZONE");

  } else {
    Serial.println("GPS FIX UNAVAILABLE");
  }

  Serial.print("Speed (km/h): ");
  Serial.println(
    gps.speed.isValid() ? gps.speed.kmph() : 0.0
  );

  Serial.print("WiFi: ");
  Serial.println(
    WiFi.status() == WL_CONNECTED ? "CONNECTED" : "DISCONNECTED"
  );

  Serial.println("==========================");
}

// ==========================================
// SEND LOCATION TO FLASK SERVER
// ==========================================

void sendLocation() {

  if (!gps.location.isValid() ||
      gps.location.age() > GPS_TIMEOUT) {

    Serial.println("GPS fix not ready. Upload skipped.");
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {

    Serial.println("WiFi disconnected. Upload skipped.");
    return;
  }

  checkGeofence();

  double distance = TinyGPSPlus::distanceBetween(
    gps.location.lat(),
    gps.location.lng(),
    HOME_LATITUDE,
    HOME_LONGITUDE
  );

  JsonDocument doc;

  doc["device_id"] = DEVICE_ID;

  doc["latitude"] = gps.location.lat();
  doc["longitude"] = gps.location.lng();

  doc["speed_kmph"] =
    gps.speed.isValid() ? gps.speed.kmph() : 0.0;

  doc["satellites"] =
    gps.satellites.isValid() ? gps.satellites.value() : 0;

  doc["hdop"] =
    gps.hdop.isValid() ? gps.hdop.hdop() : 0.0;

  // GEOFENCE DATA
  doc["geofence_status"] =
    outsideZone ? "OUTSIDE" : "IN_ZONE";

  doc["distance_from_home_m"] = distance;

  // DASHBOARD ALERT MESSAGE
  doc["alert_message"] =
    outsideZone
    ? "WARNING: Device is outside Home Safe Zone!"
    : "Device is inside Home Safe Zone.";

  doc["buzzer_state"] =
    outsideZone ? "ON" : "OFF";

  String payload;
  serializeJson(doc, payload);

  HTTPClient http;

  http.begin(API_URL);

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", DEVICE_API_KEY);

  http.setTimeout(8000);

  Serial.println();
  Serial.println("Sending GPS Data...");
  Serial.println(payload);

  int httpCode = http.POST(payload);

  if (httpCode > 0) {

    Serial.print("HTTP Response Code: ");
    Serial.println(httpCode);

    String response = http.getString();

    Serial.print("Server Response: ");
    Serial.println(response);

    if (httpCode == 200 || httpCode == 201) {
      Serial.println("GPS DATA UPLOADED SUCCESSFULLY!");
    } else {
      Serial.println("SERVER ERROR - CHECK FLASK API");
    }

  } else {

    Serial.print("HTTP Request Failed: ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
}

// ==========================================
// SETUP
// ==========================================

void setup() {

  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("================================");
  Serial.println(" XIAO ESP32-C3 GPS TRACKER");
  Serial.println(" GEOFENCE + BUZZER SYSTEM");
  Serial.println("================================");

  // Initialize buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerOff();

  // Initialize GPS
  gpsSerial.begin(
    GPS_BAUD,
    SERIAL_8N1,
    GPS_RX_PIN,
    GPS_TX_PIN
  );

  Serial.println("GPS UART Started!");

  // Start WiFi
  connectWiFi();

  Serial.println("System Initialization Complete!");
}

// ==========================================
// MAIN LOOP
// ==========================================

void loop() {

  // Read GPS continuously
  while (gpsSerial.available() > 0) {

    char c = gpsSerial.read();
    gps.encode(c);
  }

  // Update geofence
  checkGeofence();

  // Update buzzer
  updateBuzzer();

  // Maintain WiFi
  maintainWiFi();

  // Print status every 3 seconds
  if (millis() - lastStatusTime >= STATUS_INTERVAL) {

    lastStatusTime = millis();
    printGPSStatus();
  }

  // Upload location every 10 seconds
  if (millis() - lastSendTime >= SEND_INTERVAL) {

    lastSendTime = millis();
    sendLocation();
  }

  delay(5);
}
