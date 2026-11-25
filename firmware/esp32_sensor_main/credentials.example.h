#ifndef AGRAPATHA_SENSOR_CREDENTIALS_H
#define AGRAPATHA_SENSOR_CREDENTIALS_H

/**
 * AGRAPATHA ESP32 SENSOR MAIN NODE — CREDENTIAL TEMPLATE
 *
 * Setup instructions:
 * 1. Copy this file to 'credentials.h' in the same folder:
 *      cp credentials.example.h credentials.h
 * 2. Fill in your actual Wi-Fi and EMQX Cloud credentials.
 * 3. Provide the trusted Root CA certificate (PEM format) for EMQX Cloud (Port 8883).
 *    For EMQX Cloud Serverless (*.emqxsl.com), this is typically the ISRG Root X1
 *    (Let's Encrypt) or DigiCert Global Root CA.
 * 4. Delete or comment out the CREDENTIALS_PLACEHOLDER line below.
 * 5. 'credentials.h' is ignored by Git and will not be tracked or committed.
 */

// Compile-time guard: remove or comment this line once real credentials are set.
#define CREDENTIALS_PLACEHOLDER

#define SECRET_WIFI_SSID        "YOUR_WIFI_SSID"
#define SECRET_WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"
#define SECRET_MQTT_USERNAME    "agrapatha"
#define SECRET_MQTT_PASSWORD    "agrapatha123"

/**
 * Root CA Certificate (PEM format) for EMQX Cloud TLS validation on Port 8883.
 * Include full PEM boundary headers with newlines (\n).
 */
#define SECRET_MQTT_CA_CERT \
"-----BEGIN CERTIFICATE-----\n" \
"YOUR_MQTT_ROOT_CA_CERTIFICATE_HERE\n" \
"-----END CERTIFICATE-----\n"

#endif // AGRAPATHA_SENSOR_CREDENTIALS_H
