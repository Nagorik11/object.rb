# object.rb

Aplicación Ruby/Sinatra con acceso por **magic link por correo**. No requiere contraseña ni SMS. Al confirmar un correo por primera vez se crea la cuenta; en los siguientes accesos se reutiliza.

## Desarrollo

Requiere Ruby 3.4.11 y Bundler. En el entorno cloud preparado:

```bash
export PATH=/workspace/.cloud-setup/ruby/bin:$PATH
cd /workspace/object.rb
bundle config set --local path vendor/bundle
BUNDLE_FROZEN=true bundle install
MAIL_DELIVERY=file bundle exec rackup -s puma -o 127.0.0.1 -p 9292
```

`MAIL_DELIVERY=file` es exclusivamente para desarrollo: guarda los mensajes en `var/mail/*.eml`, con permisos privados, sin enviar correo real. Para probar el flujo, solicita un enlace en el formulario, abre el enlace del archivo `.eml` en un navegador y confirma el correo mostrado. Puedes usar otro navegador o dispositivo que alcance el mismo servidor. No compartas estos archivos: contienen enlaces de acceso.

No se carga `.env` automáticamente. `.env.example` documenta las variables; configúralas en el proceso o en los ajustes del entorno.

## Correo real

El adaptador usa la API HTTPS de Resend, sin SDK ni servidor SMTP. Configura:

| Variable | Uso |
| --- | --- |
| `RESEND_API_KEY` | Clave de Resend con permiso para enviar correos. Guárdala como secreto. |
| `MAIL_FROM` | Dirección de remitente de un dominio verificado en Resend. |
| `APP_BASE_URL` | Origen público del servidor, sin rutas ni parámetros. HTTPS en producción. |
| `MAIL_DELIVERY` | Elimina `file` para enviar por Resend. |
| `RACK_ENV` | `production` en producción. |
| `SESSION_SECRET` | Secreto aleatorio de al menos 64 caracteres; obligatorio en producción. |
| `DATABASE_PATH` | Opcional; por defecto `var/login.sqlite3`. |

Autoriza la salida HTTPS a `api.resend.com`. Una cuenta de Resend sin dominio verificado puede restringir destinatarios. Nunca incluyas claves en Git. El correo real requiere configurar y verificar estas credenciales; las pruebas automatizadas no envían mensajes.

En desarrollo se genera un secreto persistente en `var/session_secret`. En producción usa un secreto propio y estable. Arranca con `bundle exec rackup -s puma` detrás de un proxy HTTPS. Mantén un solo servidor con almacenamiento persistente para SQLite; configura tu proxy para sanear las cabeceras de IP y no registrar el parámetro `token` de los enlaces. No registres cuerpos, cookies ni mensajes de correo.

## Flujo y protecciones

- Solicitud de enlace con validación de correo y protección CSRF.
- Tokens aleatorios de 256 bits; SQLite guarda solamente su hash SHA-256.
- Caducidad a los 15 minutos y consumo atómico de un solo uso. Al entrar se invalidan otros enlaces pendientes del mismo correo.
- Abrir el enlace mediante GET no inicia sesión ni consume el token. Una pantalla muestra el correo y pide confirmación por POST para evitar que los escáneres de correo consuman enlaces.
- Máximo un envío por minuto y tres cada 15 minutos por correo, y veinte por IP cada 15 minutos. Los envíos fallidos también cuentan.
- Cookies de sesión cifradas, HttpOnly y SameSite=Lax; Secure en producción. La sesión dura una hora y se limpia al entrar o salir.
- Mensajes, base de datos y secretos locales quedan fuera de Git.

## Pruebas

```bash
bundle exec rake test
```

Cubren acceso, cierre de sesión, CSRF, correo inválido, errores de entrega, expiración, reutilización, consumo concurrente, persistencia, límites y el adaptador de correo. Los dobles del proveedor se inyectan solo desde los tests; no hay una ruta de acceso de prueba en la aplicación.
