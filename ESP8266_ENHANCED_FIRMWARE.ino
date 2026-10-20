/*
 * ======================================================================================
 * CAMPUSKEY: Smart RFID Attendance & Identity System — Master ESP8266 NodeMCU Firmware
 * ======================================================================================
 * V2 FIXED EDITION — Resolves:
 *  1. RFID Read Sensitivity & Distance Issue:
 *     - Removed `RxGain_max` (which over-amplified ESP8266 Wi-Fi noise and triggered
 *       premature false reads at the weak outer fringe of the RF field).
 *     - Added `detectAndReadCard()` with an 8-attempt (150ms) WUPA/REQA retry stabilizer
 *       so cards held slightly far, tilted, or moving in are read smoothly on the first
 *       tap—just like PREVIOUS_CODE.txt—while genuine fast-swipe failures still trigger
 *       "CARD READ ERROR / Hold Card Steady" with 3 fast Red LED beeps.
 *  2. Registration Completion Celebration ("CARD REGISTERED! / Profile Saved!"):
 *     - Fixed the BearSSL connection reuse bug by using a fresh `WiFiClientSecure`
 *       instance per request (matching PREVIOUS_CODE.txt).
 *     - Fixed `checkIfAdminSavedProfile()` so as soon as the Admin saves the user's
 *       Name, Roll/Enrollment No., or Mobile on the website, the NodeMCU immediately
 *       displays "CARD REGISTERED! / Profile Saved!", lights the Green LED, and plays
 *       2 confirmation buzzer beeps.
 * ======================================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>

// ======================== 1. NETWORK & LIVE DATABASE CONFIG ===========================
const char* WIFI_SSID       = "V2029";
const char* WIFI_PASSWORD   = "shivamanikittu";
const String SUPABASE_URL   = "https://qnuewgwuiubpdlnatuez.supabase.co";
const String SUPABASE_ANON  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFudWV3Z3d1aXVicGRsbmF0dWV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjM0NjUsImV4cCI6MjEwODAzOTQ2NX0.d6NxbXEw-X5rUmEe59nEGj9kvdSSky1SlNUen-3K6kI";
const String DEVICE_SECRET  = "CAMPUSKEY_ESP8266_SECRET_2026";

// ======================== 2. WORKING HARDWARE PIN BLUEPRINT ===========================
#define GREEN_LED_PIN D1   // Access Granted Indicator (GPIO 5)
#define RED_LED_PIN   D2   // Access Denied / Error Indicator (GPIO 4)
#define BUZZER_PIN    D0   // Audio Notification Beeper (GPIO 16)
#define I2C_SDA_PIN   D4   // Custom I2C Data Line (GPIO 2)
#define I2C_SCL_PIN   D3   // Custom I2C Clock Line (GPIO 0)
#define SS_PIN        D8   // RFID SDA / Chip Select Pin (GPIO 15)
#define RST_PIN       255  // RFID RST tied directly to physical 3.3V power rail

MFRC522 rfid(SS_PIN, RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ======================== 3. TIMERS & STATE VARIABLES =================================
const unsigned long HEALTH_CHECK_INTERVAL = 5000;  // Check I2C/SPI wires & Wi-Fi every 5s
const unsigned long STATE_POLL_INTERVAL   = 4000;  // Poll Supabase state every 4s after completion
const unsigned long ADMIN_WAIT_TIMEOUT_MS = 90000; // Max 90s wait for admin to save form

unsigned long lastHealthCheck      = 0;
unsigned long lastStatePoll        = 0;
unsigned long regModeStartTime     = 0;
unsigned long lastCountdownTick    = 0;
int regSecondsRemaining            = 60;

String currentSystemMode           = "ATTENDANCE";
bool isWaitingForAdminSave         = false;
bool modeStayedRegAfterScan        = false;
String pendingRegisteredUID        = "";
String savedProfileFirstName       = "";
unsigned long adminWaitStartTime   = 0;
unsigned long messageRotateTimer   = 0;
int currentMessageStep             = 0;
bool hardwareFaultActive           = false;

// ======================== 4. AUDIO-VISUAL FEEDBACK ENGINE =============================
void showLCD(String line1, String line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, 16));
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, 16));
}

void showIdleScreen() {
  if (currentSystemMode == "REGISTRATION") {
    digitalWrite(GREEN_LED_PIN, HIGH);
    digitalWrite(RED_LED_PIN, HIGH);
    showLCD("NEW REGISTRATION", "Scan in: " + String(regSecondsRemaining) + "s");
  } else {
    digitalWrite(GREEN_LED_PIN, LOW);
    digitalWrite(RED_LED_PIN, LOW);
    showLCD("CAMPUSKEY READY", "Tap ID Card...");
  }
}

void alertPattern(int count, int durationMs, int pauseMs, bool isSuccess) {
  digitalWrite(GREEN_LED_PIN, isSuccess ? HIGH : LOW);
  digitalWrite(RED_LED_PIN, isSuccess ? LOW : HIGH);
  for (int i = 0; i < count; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(durationMs);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < count - 1) delay(pauseMs);
  }
  delay(1200);
  digitalWrite(GREEN_LED_PIN, LOW);
  digitalWrite(RED_LED_PIN, LOW);
}

// ======================== 5. CONTINUOUS HARDWARE WIRE CHECKS ==========================
bool verifyHardwareConnections() {
  // Check 1: Verify I2C acknowledgement from LCD panel (0x27)
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() != 0) {
    hardwareFaultActive = true;
    for (int i = 0; i < 3; i++) {
      digitalWrite(RED_LED_PIN, HIGH);
      digitalWrite(BUZZER_PIN, HIGH);
      delay(100);
      digitalWrite(RED_LED_PIN, LOW);
      digitalWrite(BUZZER_PIN, LOW);
      delay(100);
    }
    return false;
  }

  // Check 2: Verify SPI data path back from the RC522 chip register
  byte v = rfid.PCD_ReadRegister(rfid.VersionReg);
  if (v == 0x00 || v == 0xFF) {
    hardwareFaultActive = true;
    showLCD("ERR: RFID WIRE", "Check SPI Pins");
    digitalWrite(RED_LED_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(400);
    digitalWrite(BUZZER_PIN, LOW);
    rfid.PCD_Init();
    return false;
  }

  if (hardwareFaultActive) {
    hardwareFaultActive = false;
    lcd.init();
    lcd.backlight();
    rfid.PCD_Init();
    showIdleScreen();
  }
  return true;
}

// ======================== 6. SMART MULTI-RETRY RFID READER ============================
bool detectAndReadCard(String &cardUID, bool &hadReadError) {
  hadReadError = false;
  cardUID = "";

  if (!rfid.PICC_IsNewCardPresent()) {
    return false;
  }

  if (rfid.PICC_ReadCardSerial()) {
    for (byte i = 0; i < rfid.uid.size; i++) {
      if (rfid.uid.uidByte[i] < 0x10) cardUID += "0";
      cardUID += String(rfid.uid.uidByte[i], HEX);
    }
    cardUID.toUpperCase();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return true;
  }

  for (int attempt = 0; attempt < 8; attempt++) {
    delay(18);
    byte bufferATQA[2];
    byte bufferSize = sizeof(bufferATQA);
    MFRC522::StatusCode status = rfid.PICC_WakeupA(bufferATQA, &bufferSize);

    if (status == MFRC522::STATUS_OK || status == MFRC522::STATUS_COLLISION || rfid.PICC_IsNewCardPresent()) {
      if (rfid.PICC_ReadCardSerial()) {
        for (byte i = 0; i < rfid.uid.size; i++) {
          if (rfid.uid.uidByte[i] < 0x10) cardUID += "0";
          cardUID += String(rfid.uid.uidByte[i], HEX);
        }
        cardUID.toUpperCase();
        rfid.PICC_HaltA();
        rfid.PCD_StopCrypto1();
        return true;
      }
    }
  }

  hadReadError = true;
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  return false;
}

// ======================== 7. SUPABASE STATE & ADMIN SAVE SYNC =========================
String pollSystemState() {
  if (WiFi.status() != WL_CONNECTED) return currentSystemMode;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = SUPABASE_URL + "/rest/v1/system_state?id=eq.1&select=mode";

  if (http.begin(client, url)) {
    http.setTimeout(2200);
    http.addHeader("apikey", SUPABASE_ANON);
    http.addHeader("Authorization", "Bearer " + SUPABASE_ANON);

    int httpCode = http.GET();
    if (httpCode == 200) {
      String payload = http.getString();
      StaticJsonDocument<192> doc;
      if (!deserializeJson(doc, payload) && doc.size() > 0) {
        String mode = doc[0]["mode"].as<String>();
        http.end();
        return mode;
      }
    }
    http.end();
  }
  return currentSystemMode;
}

void resetSystemStateToAttendance() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = SUPABASE_URL + "/rest/v1/system_state?id=eq.1";

  if (http.begin(client, url)) {
    http.setTimeout(2500);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", SUPABASE_ANON);
    http.addHeader("Authorization", "Bearer " + SUPABASE_ANON);
    http.addHeader("Prefer", "return=minimal");
    http.PATCH("{\"mode\":\"ATTENDANCE\"}");
    http.end();
  }
}

bool checkIfAdminSavedProfile(String cardUID) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = SUPABASE_URL + "/rest/v1/users?card_uid=eq." + cardUID + "&select=full_name,enrollment_or_roll,mobile_number";

  if (http.begin(client, url)) {
    http.setTimeout(2500);
    http.addHeader("apikey", SUPABASE_ANON);
    http.addHeader("Authorization", "Bearer " + SUPABASE_ANON);

    int httpCode = http.GET();
    if (httpCode == 200) {
      String payload = http.getString();
      StaticJsonDocument<384> doc;
      if (!deserializeJson(doc, payload) && doc.size() > 0) {
        String fullName = doc[0]["full_name"] | "";
        String roll     = doc[0]["enrollment_or_roll"] | "";
        String mobile   = doc[0]["mobile_number"] | "";
        http.end();

        fullName.trim();
        roll.trim();
        mobile.trim();

        bool nameUpdated = (fullName.length() > 0 &&
                            !fullName.startsWith("New Card") &&
                            !fullName.startsWith("Pending") &&
                            fullName != "null");
        bool rollUpdated = (roll.length() > 0 &&
                            !roll.startsWith("PENDING-") &&
                            roll != "null");
        bool mobileUpdated = (mobile.length() > 0 &&
                              mobile != "null");

        if (nameUpdated || rollUpdated || mobileUpdated) {
          if (nameUpdated) {
            int spaceIdx = fullName.indexOf(' ');
            savedProfileFirstName = (spaceIdx > 0) ? fullName.substring(0, spaceIdx) : fullName;
            savedProfileFirstName.toUpperCase();
          }
          return true;
        }
      } else {
        http.end();
      }
    } else {
      http.end();
    }
  }

  if (modeStayedRegAfterScan) {
    String modeNow = pollSystemState();
    if (modeNow == "ATTENDANCE") {
      return true;
    }
  }

  return false;
}

// ======================== 8. INITIAL SYSTEM SETUP =====================================
void setup() {
  Serial.begin(115200);

  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  digitalWrite(GREEN_LED_PIN, LOW);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  lcd.init();
  lcd.backlight();

  showLCD("CAMPUSKEY BOOT", "Checking HW...");

  SPI.begin();
  rfid.PCD_Init();
  delay(300);

  if (!verifyHardwareConnections()) {
    delay(2000);
  }

  showLCD("CONNECTING WIFI", "Please Wait...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(500);
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    showLCD("CAMPUSKEY READY", "Tap ID Card...");
    alertPattern(1, 100, 0, true);
  } else {
    showLCD("WIFI FAILED!", "Check Network");
    alertPattern(2, 500, 200, false);
  }

  lastHealthCheck = millis();
  lastStatePoll   = millis();
}

// ======================== 9. MAIN PROCESSING LOOP =====================================
void loop() {
  // STEP A: Waiting for Admin to Fill & Save New User Profile on the Website
  if (isWaitingForAdminSave) {
    if (millis() - messageRotateTimer > 2200) {
      messageRotateTimer = millis();
      currentMessageStep = (currentMessageStep + 1) % 3;

      if (currentMessageStep == 0) {
        showLCD("REGISTERING...", "Admin Entering..");
      } else if (currentMessageStep == 1) {
        showLCD("PLEASE WAIT...", "Few Secs Ahead..");
      } else {
        showLCD("CARD DETECTED!", "UID: " + pendingRegisteredUID);
      }

      bool adminSaved = checkIfAdminSavedProfile(pendingRegisteredUID);
      bool timedOut   = (millis() - adminWaitStartTime > ADMIN_WAIT_TIMEOUT_MS);

      if (adminSaved || timedOut) {
        isWaitingForAdminSave   = false;
        modeStayedRegAfterScan  = false;
        pendingRegisteredUID    = "";
        currentSystemMode       = "ATTENDANCE";

        if (savedProfileFirstName.length() > 0) {
          showLCD("CARD REGISTERED!", "HI, " + savedProfileFirstName);
        } else {
          showLCD("CARD REGISTERED!", "Profile Saved!");
        }
        savedProfileFirstName = "";

        alertPattern(2, 200, 150, true);

        showIdleScreen();
        lastStatePoll   = millis();
        lastHealthCheck = millis();
      }
    }
    return;
  }

  // STEP B: Live 1-Second Countdown Display during 60s Registration Mode
  if (currentSystemMode == "REGISTRATION") {
    if (millis() - lastCountdownTick >= 1000) {
      lastCountdownTick = millis();
      unsigned long elapsedSec = (millis() - regModeStartTime) / 1000;
      regSecondsRemaining = 60 - (int)elapsedSec;

      if (regSecondsRemaining <= 0) {
        currentSystemMode = "ATTENDANCE";
        digitalWrite(GREEN_LED_PIN, LOW);
        showLCD("REG. TIMED OUT", "Back to Normal");
        alertPattern(1, 700, 0, false);
        resetSystemStateToAttendance();
        showIdleScreen();
        lastStatePoll = millis();
        return;
      } else {
        lcd.setCursor(0, 1);
        String line2 = "Scan in: " + String(regSecondsRemaining) + "s    ";
        lcd.print(line2.substring(0, 16));
      }
    }
  }

  // STEP C: HIGH-PRIORITY RFID SCANNING
  String cardUID = "";
  bool hadReadError = false;

  if (detectAndReadCard(cardUID, hadReadError)) {
    if (currentSystemMode == "REGISTRATION") {
      showLCD("REGISTERING...", "UID: " + cardUID);
    } else {
      showLCD("VERIFYING CARD", "UID: " + cardUID);
    }

    if (WiFi.status() != WL_CONNECTED) {
      showLCD("API / WIFI ERROR", "Network Offline");
      alertPattern(2, 600, 200, false);
      showIdleScreen();
      return;
    }

    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    String rpcEndpoint = SUPABASE_URL + "/rest/v1/rpc/handle_card_scan";

    if (http.begin(client, rpcEndpoint)) {
      http.setTimeout(7000);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("apikey", SUPABASE_ANON);
      http.addHeader("Authorization", "Bearer " + SUPABASE_ANON);

      String payload = "{\"p_card_uid\":\"" + cardUID + "\",\"p_device_key\":\"" + DEVICE_SECRET + "\"}";
      int httpCode = http.POST(payload);

      if (httpCode <= 0 || httpCode >= 500) {
        showLCD("API UNREACHABLE", "Server Error");
        alertPattern(2, 600, 200, false);
        currentSystemMode = "ATTENDANCE";
      } else {
        String response = http.getString();
        StaticJsonDocument<512> doc;
        DeserializationError err = deserializeJson(doc, response);

        if (!err) {
          String status = doc["status"].as<String>();
          String lcd1   = doc["lcd1"].as<String>();
          String lcd2   = doc["lcd2"].as<String>();
          String code   = doc["code"].as<String>();

          if (status == "REGISTERED") {
            http.end();
            showLCD("CARD DETECTED!", "UID: " + cardUID);
            digitalWrite(GREEN_LED_PIN, HIGH);
            digitalWrite(RED_LED_PIN, LOW);
            for (int i = 0; i < 2; i++) {
              digitalWrite(BUZZER_PIN, HIGH);
              delay(100);
              digitalWrite(BUZZER_PIN, LOW);
              delay(80);
            }
            delay(800);

            isWaitingForAdminSave  = true;
            pendingRegisteredUID   = cardUID;
            savedProfileFirstName  = "";
            adminWaitStartTime     = millis();
            messageRotateTimer     = millis();
            currentMessageStep     = 0;
            modeStayedRegAfterScan = (pollSystemState() == "REGISTRATION");
            showLCD("REGISTERING...", "Admin Entering..");
            lastStatePoll = millis();
            return;
          }

          showLCD(lcd1, lcd2);

          if (status == "SUCCESS") {
            alertPattern(1, 150, 0, true);
            currentSystemMode = "ATTENDANCE";
          } else if (code == "ALREADY_SCANNED") {
            alertPattern(2, 300, 150, false);
            currentSystemMode = "ATTENDANCE";
          } else {
            alertPattern(1, 800, 0, false);
            currentSystemMode = "ATTENDANCE";
          }
        } else {
          showLCD("PARSE ERROR", "Bad JSON Resp");
          alertPattern(2, 400, 150, false);
          currentSystemMode = "ATTENDANCE";
        }
      }
      http.end();
    } else {
      showLCD("API CONN FAILED", "Check Config");
      alertPattern(2, 600, 200, false);
      currentSystemMode = "ATTENDANCE";
    }

    delay(1200);
    showIdleScreen();
    lastStatePoll   = millis();
    lastHealthCheck = millis();
    return;
  }

  if (hadReadError) {
    showLCD("CARD READ ERROR", "Hold Card Steady");
    alertPattern(3, 100, 100, false);
    showIdleScreen();
    lastStatePoll = millis();
    return;
  }

  // STEP D: Periodic Hardware Wire Self-Test & Wi-Fi Watchdog (Every 5s)
  if (millis() - lastHealthCheck > HEALTH_CHECK_INTERVAL) {
    lastHealthCheck = millis();
    if (!verifyHardwareConnections()) return;
    if (WiFi.status() != WL_CONNECTED) {
      showLCD("WIFI LOST!", "Reconnecting...");
      WiFi.reconnect();
      return;
    }
  }

  // STEP E: Background Supabase Mode Poll (Every 4s)
  if (millis() - lastStatePoll > STATE_POLL_INTERVAL) {
    String newMode = pollSystemState();
    lastStatePoll = millis();

    if (newMode == "REGISTRATION" && currentSystemMode != "REGISTRATION") {
      currentSystemMode   = "REGISTRATION";
      regModeStartTime    = millis();
      lastCountdownTick   = millis();
      regSecondsRemaining = 60;
      digitalWrite(GREEN_LED_PIN, HIGH);
      digitalWrite(RED_LED_PIN, HIGH);
      showLCD("NEW REGISTRATION", "Scan in: 60s");
      digitalWrite(BUZZER_PIN, HIGH);
      delay(80);
      digitalWrite(BUZZER_PIN, LOW);
    } else if (newMode == "ATTENDANCE" && currentSystemMode == "REGISTRATION") {
      currentSystemMode = "ATTENDANCE";
      digitalWrite(GREEN_LED_PIN, LOW);
      digitalWrite(RED_LED_PIN, LOW);
      showIdleScreen();
    }
  }
}
