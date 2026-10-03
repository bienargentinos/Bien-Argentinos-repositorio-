/*
 * esp32_relay_porteria.ino - Firmware para módulo ESP32 + Relé de Apertura (Marcos IA)
 * ------------------------------------------------------------------------------------
 * Este firmware conecta el ESP32 a la red WiFi del consorcio y sondea el servidor
 * de Marcos IA (o recibe webhooks) para activar el relé que abre la cerradura
 * electromagnética o pestillo eléctrico (12V/24V) ante un pase QR o llamado atendido.
 *
 * Hardware recomendado:
 * - ESP32 NodeMCU / ESP32-WROOM-32
 * - Módulo Relé 5V de 1 o 2 canales con optoacoplador
 * - Fuente 12V 2A (para cerradura) + Convertidor Step-Down 5V (para ESP32)
 *
 * Conexión de Pines:
 * - GPIO 23 -> IN del módulo Relé (o pin configurable en RELAY_PIN)
 * - GPIO 2  -> LED de estado integrado
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// --- CONFIGURACIÓN WIFI Y SERVIDOR ---
const char* WIFI_SSID = "TU_WIFI_CONSORCIO";
const char* WIFI_PASS = "PASSWORD_WIFI";

const char* MARCOS_SERVER = "https://marcos.bienargentinos.com";
const char* EDIFICIO = "San Patricio 159"; // Nombre exacto del edificio

// --- CONFIGURACIÓN HARDWARE ---
const int RELAY_PIN = 23;        // Pin conectado al IN del relé
const int LED_STATUS_PIN = 2;    // LED de feedback en el ESP32
const bool RELAY_ACTIVE_LOW = true; // La mayoría de módulos relé se activan con LOW

// Intervalo de sondeo (polling) al servidor (ms)
const unsigned long POLL_INTERVAL_MS = 1500; 
unsigned long ultimoPoll = 0;

void activarPuerta(int segundos = 3) {
  Serial.printf("[PUERTA] ¡Activando relé por %d segundos!\n", segundos);
  digitalWrite(LED_STATUS_PIN, HIGH);
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? LOW : HIGH);
  
  delay(segundos * 1000);
  
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? HIGH : LOW);
  digitalWrite(LED_STATUS_PIN, LOW);
  Serial.println("[PUERTA] Relé desactivado. Puerta cerrada.");
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  
  Serial.print("[WIFI] Conectando a ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  int intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 20) {
    delay(500);
    Serial.print(".");
    intentos++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] ¡Conectado! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WIFI] Reintentando en el próximo ciclo...");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== MARCOS IA · CONTROLADOR DE RELÉ ESP32 ===");

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_STATUS_PIN, OUTPUT);
  // Estado inicial: relé apagado
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? HIGH : LOW);
  digitalWrite(LED_STATUS_PIN, LOW);

  conectarWiFi();
}

void verificarAperturas() {
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
    return;
  }

  HTTPClient http;
  String url = String(MARCOS_SERVER) + "/porteria/api/puerta/status?edificio=" + urlEncode(EDIFICIO);
  
  http.begin(url);
  http.setTimeout(3000);
  
  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    
    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      bool abrir = doc["abrir"] | false;
      if (abrir) {
        int seg = doc["segundosActivacion"] | 3;
        const char* motivo = doc["motivo"] | "Apertura";
        Serial.printf("[ACCESO] Recibida orden de apertura. Motivo: %s\n", motivo);
        activarPuerta(seg);
      }
    }
  } else {
    Serial.printf("[HTTP] Error en consulta: %d\n", httpCode);
  }
  http.end();
}

String urlEncode(String str) {
  String encoded = "";
  char c;
  for (size_t i = 0; i < str.length(); i++) {
    c = str.charAt(i);
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      encoded += c;
    } else if (c == ' ') {
      encoded += "%20";
    } else {
      char hex[4];
      snprintf(hex, sizeof(hex), "%%%02X", (unsigned char)c);
      encoded += hex;
    }
  }
  return encoded;
}

void loop() {
  unsigned long ahora = millis();
  if (ahora - ultimoPoll >= POLL_INTERVAL_MS) {
    ultimoPoll = ahora;
    verificarAperturas();
  }
  delay(10);
}
