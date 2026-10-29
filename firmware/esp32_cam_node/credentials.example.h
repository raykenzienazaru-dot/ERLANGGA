#ifndef AGRAPATHA_CAM_CREDENTIALS_H
#define AGRAPATHA_CAM_CREDENTIALS_H

/**
 * AGRAPATHA ESP32-CAM AI VISION NODE — CREDENTIAL TEMPLATE
 *
 * Setup instructions:
 * 1. Copy this file to 'credentials.h' in the same folder:
 *      cp credentials.example.h credentials.h
 * 2. Fill in your actual Wi-Fi credentials.
 * 3. Provide the trusted Root CA certificate (PEM format) for the Railway HTTPS
 *    inference endpoint (Port 443). Railway services (*.up.railway.app) use
 *    ISRG Root X1 (Let's Encrypt).
 * 4. Delete or comment out the CREDENTIALS_PLACEHOLDER line below.
 * 5. 'credentials.h' is ignored by Git and will not be tracked or committed.
 */

// Compile-time guard: remove or comment this line once real credentials are set.
#define CREDENTIALS_PLACEHOLDER

#define SECRET_WIFI_SSID        "YOUR_WIFI_SSID"
#define SECRET_WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"

/**
 * Root CA Certificate (PEM format) for Railway HTTPS validation on Port 443.
 * Include full PEM boundary headers with newlines (\n).
 */
#define SECRET_AI_CA_CERT \
"-----BEGIN CERTIFICATE-----\n" \
"YOUR_AI_ROOT_CA_CERTIFICATE_HERE\n" \
"-----END CERTIFICATE-----\n"

#endif // AGRAPATHA_CAM_CREDENTIALS_H
