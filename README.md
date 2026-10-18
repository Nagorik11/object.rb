# object.rb

## Frontend RD.Object en Cloudflare

`worker.js` sirve el chat y el registro de visitantes con **nombre y foto de perfil**. Al guardar, crea un registro nuevo en `shared-db.users` con un UUID generado por el servidor y el rol `visitor`. El recuadro muestra ese UUID real, el nombre, la foto y el nivel Visitante. No genera IDs locales ni usa el UUID de otra persona.

La cámara se activa únicamente al pulsar **Activar cámara**; también se puede elegir una foto. La imagen se recorta a 256 × 256 y se guarda como JPEG en `users.profile.visitor_photo`. Se pide confirmación para guardar nombre y foto. La imagen no realiza reconocimiento facial ni verifica identidades: coincidir en nombre o foto no permite entrar a una cuenta existente.

Para habilitarlo en Cloudflare:

1. En el Worker `object-rd`, enlaza la base D1 existente `shared-db` con el nombre **`SHARED_DB`**. Conserva el binding de Workers AI **`AI`**.
2. Ejecuta [migrations/0001_visitor_sessions.sql](migrations/0001_visitor_sessions.sql) en esa base. Es una migración aditiva y repetible; no reemplaza `users` ni cambia sus filas existentes.
3. Despliega `worker.js` junto con los módulos de `worker/`. Para Wrangler, copia `wrangler.example.jsonc` a `wrangler.jsonc` y coloca el UUID **de la base D1**, distinto del UUID del usuario. Si tu Worker tiene otros bindings o rutas, consérvalos también en la configuración antes de desplegar.

Para ejecutar la migración desde Wrangler, el token también necesita permiso de edición de D1 en la cuenta correspondiente. Este cambio no se ha desplegado ni ha ejecutado la migración en la base real.

El código usa las columnas de `users` mostradas en la base: `id`, `handle`, `display_name`, `email`, `locale`, `timezone`, `status`, `profile`, `meta`, `created_at`, `updated_at`. Los visitantes reciben un `handle` único, estado `active`, correo nulo y `profile.roles = ["visitor"]`. La compatibilidad con restricciones adicionales de la base real requiere validación cuando se disponga de acceso.

La sesión de visitante dura 30 días en el mismo navegador, con una cookie Secure/HttpOnly y un token cuyo hash se almacena en `rd_visitor_sessions`. **Salir** revoca esa sesión; no elimina el perfil ni su foto. Borrar cookies o perder la sesión no permite recuperar una cuenta por nombre/foto: el acceso a cuentas existentes requiere su propio método de autenticación. El chat conserva el acceso público existente; este registro no asigna permisos de administrador.

Se limitan los registros a cinco por IP en una hora, incluyendo los que luego cierran sesión. La foto se entrega solamente con la sesión correspondiente, no mediante una consulta pública por UUID. La validación automatizada usa SQLite local y no modifica `shared-db` ni demuestra un despliegue real.

Pruebas del Worker con Node.js 24, sin instalar dependencias:

```bash
npm test
```

## Aplicación Ruby

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
