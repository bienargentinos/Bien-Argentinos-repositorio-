# Marcos IA

Asistente de IA 24/7 para administración de consorcios (WhatsApp + llamadas), con dashboard de administración.

## Configuración local

1. `npm install`
2. Copiar `.env.example` a `.env` y completar los valores reales (tokens de Meta, Gemini, OpenAI, ElevenLabs, SMTP, etc.). El archivo `.env` no se versiona.
3. Colocar el archivo de credenciales de la cuenta de servicio de Google Cloud (Sheets/TTS) en esta carpeta y apuntar `GOOGLE_CREDENTIALS_FILE` en `.env` a su nombre. Tampoco se versiona.
4. `node index.js`
