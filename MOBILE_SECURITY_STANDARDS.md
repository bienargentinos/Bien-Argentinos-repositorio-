# Skill / Guía Maestra de Arquitectura & Seguridad Móvil (Android / iOS)
## Edifica & Marcos IA - Zero Trust & OWASP MASVS Standard

Esta guía y skill define las reglas obligatorias de arquitectura, desarrollo y seguridad para todas las aplicaciones móviles y APIs del ecosistema **Marcos IA / Edifica**. Diseñada para que cualquier agente de IA (Antigravity, Claude Web, etc.) o desarrollador humano implemente código 100% blindado contra vulnerabilidades comunes y ataques externos.

---

## 1. Principios Fundamentales (Zero Trust)
1. **Nunca confiar en el cliente móvil:** Todo lo que corre en un teléfono (Android o iOS) puede ser desensamblado, interceptado o modificado.
2. **Validación y autorización obligatoria en el backend:** El móvil solo presenta datos. Ninguna regla de negocio, cálculo crítico de dinero/expensas o autorización debe descansar únicamente en la app.
3. **Mínimo privilegio:** La app solo solicita los permisos de hardware estrictamente necesarios en el momento en que se usan.

---

## 2. Almacenamiento Seguro de Datos (Data at Rest)

### Prohibido Terminantemente ❌
* Guardar tokens JWT, contraseñas, claves de API o datos personales en `SharedPreferences` (Android) o `UserDefaults` (iOS) en texto plano.
* Dejar logs de debug con información sensible (`Log.d`, `NSLog`, `print`) en builds de producción.
* Almacenar bases de datos locales (SQLite/Room/Realm) sin cifrar.

### Obligatorio Implementar ✅
* **Android:**
  * Uso de **`EncryptedSharedPreferences`** (`androidx.security.crypto.EncryptedSharedPreferences`).
  * Generación y almacenamiento de claves simétricas mediante el **Android Keystore System** (aislado a nivel hardware/TEE).
  * Si se usa base de datos local (Room/SQLite), cifrarla con **SQLCipher**.
* **iOS:**
  * Almacenamiento de credenciales y tokens únicamente en el **Keychain de iOS** con atributos de accesibilidad restrictivos (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).
* **Regla de Cache:** Forzar limpieza de memoria/cache sensible al cerrar sesión (`logout`).

---

## 3. Seguridad de Red y Comunicaciones (Data in Transit)

### Prohibido Terminantemente ❌
* Permitir conexiones HTTP en texto plano (`cleartext`).
* Ignorar o deshabilitar la validación de certificados SSL/TLS ("Trust All Certificates" / ignorar alertas TLS).
* Incluir API Keys con permisos de escritura/admin de servicios como Supabase, Firebase, Stripe o Meta directo en el binario móvil.

### Obligatorio Implementar ✅
* **Android:**
  * Definir archivo `res/xml/network_security_config.xml`:
    ```xml
    <network-security-config>
        <base-config cleartextTrafficPermitted="false">
            <trust-anchors>
                <certificates src="system" />
            </trust-anchors>
        </base-config>
    </network-security-config>
    ```
  * Configurar `android:networkSecurityConfig="@xml/network_security_config"` en el `AndroidManifest.xml`.
* **iOS:**
  * Mantener habilitado por defecto **App Transport Security (ATS)** (`NSAppTransportSecurity`).
* **Certificate Pinning:** Para endpoints críticos (autenticación y pagos/expensas), configurar SSL Pinning en la capa HTTP (ej. OkHttp `CertificatePinner` en Android / `URLSession` pinning en iOS).

---

## 4. Control de Superficie de Ataque y Manifiesto (Android / iOS)

### Android Manifest (`AndroidManifest.xml`) ✅
* Todos los componentes (`<activity>`, `<service>`, `<receiver>`, `<provider>`) deben tener explícitamente:
  ```xml
  android:exported="false"
  ```
  a menos que deban ser invocados explícitamente por el sistema operativo (como el Launcher o Deep Links verificados).
* Deshabilitar backups automáticos no cifrados si contienen tokens o datos privados:
  ```xml
  android:allowBackup="false"
  ```
* Deshabilitar depuración en release:
  ```xml
  android:debuggable="false"
  ```

### iOS Info.plist & Capabilities ✅
* Activar únicamente los entitlements necesarios (Push Notifications, Keychain Sharing si aplica).

---

## 5. Autenticación, Sesiones y APIs (Mobile to Backend)
* **Tokens de sesión:**
  * Tokens de acceso cortos (Access Token JWT de 15 a 60 min).
  * Refresh Token con rotación automática almacenado de forma segura en Keystore/Keychain.
  * Invalidez inmediata de tokens en el servidor ante cierre de sesión.
* **Rate Limiting & Anti-Abuse:**
  * Todas las rutas de autenticación (login, validación de WhatsApp OTP, reseteo de PIN) deben tener Rate Limit en el servidor.
* **Biometría:**
  * Utilizar `BiometricPrompt` (Android) y `LocalAuthentication` / FaceID / TouchID (iOS) para confirmar operaciones críticas o desbloqueo rápido de la app.

---

## 6. Protección de Código y Ofuscación (Build Pipeline)
* **R8 / ProGuard (Android):**
  * Ofuscar nombres de clases, métodos y campos en builds de `release`.
  * Habilitar `minifyEnabled true` y `shrinkResources true`.
* **No hardcodear secretos:**
  * Claves públicas de servicios terceros (ej. Google Maps o Sentry) se inyectan en tiempo de compilación mediante variables de entorno (`local.properties` o CI/CD), nunca comiteadas al repositorio público.
