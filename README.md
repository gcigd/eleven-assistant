# Asistente de caja

PWA estática con contenido cifrado para consulta sin conexión. El navegador descarga la interfaz y `content.enc.json`; solo muestra la guía después de introducir la frase de acceso. La frase no se incluye en el repositorio ni se conserva en almacenamiento local.

La opción «Recordar en este dispositivo» guarda en IndexedDB una llave de descifrado no exportable, nunca la frase. Viene desactivada. «Olvidar dispositivo» borra la llave local y bloquea la guía. Al cambiar la sal del contenido cifrado, la llave guardada deja de servir y se solicita de nuevo la frase. El almacenamiento puede eliminarse por el navegador; entonces se deberá introducir la frase otra vez.

La sección «Entender el efectivo» incluye seis lecciones y ejercicios en el mismo contenido cifrado. El avance se guarda solamente en el almacenamiento local del dispositivo, no por persona; «Comprendido» es una autoevaluación después de completar los escenarios y explicar la idea en voz alta. «Borrar avance» reinicia esos estados. «Olvidar dispositivo» elimina la llave de acceso y el avance local.

## Publicación y acceso

Este repositorio y cualquier GitHub Pages asociado pueden ser públicos. El cifrado protege el contenido de la guía **mientras la frase siga siendo secreta y fuerte**; el nombre del repositorio, la interfaz, el código y los archivos cifrados siguen siendo visibles. Una frase compartida no identifica a cada operador ni permite revocar a uno sin cambiarla para todos.

Recordar la llave permite abrir la guía a cualquiera que tenga acceso al dispositivo o ejecute código en este origen. La llave no exportable evita extraerla mediante la API Web Crypto, pero no impide usarla en este navegador. Utilizar esta opción solo en dispositivos confiables y protegidos por bloqueo de pantalla. Safari y la PWA instalada pueden tener almacenamiento separado.

Antes de volver a publicar, verificar que GitHub Pages siga despublicado hasta completar pruebas y revisar cualquier historial o copia anterior que haya contenido datos sin cifrar. `noindex` no es una medida de control de acceso.

## Prueba local

Ejecutar `python3 -m http.server 8000` y abrir `http://localhost:8000/`. Abrir una vez con conexión, esperar el caché, luego probar con el navegador sin conexión. Al instalarla en iPhone, abrir el icono una vez con conexión antes de probar en modo avión.

## Actualización de contenido

El contenido fuente permanece fuera de este repositorio. Para cambiarlo, generar de nuevo `content.enc.json` con una frase fuerte, PBKDF2-SHA256 (600 000 iteraciones) y AES-256-GCM. Cada versión requiere un IV aleatorio nuevo. Se puede conservar la sal si se mantiene la misma frase y se desea conservar las llaves recordadas; al rotar la frase, crear también una sal aleatoria nueva; después incrementar el nombre `CACHE` en `sw.js`. Nunca subir la frase, el contenido descifrado ni archivos temporales. El archivo `.gitignore` ayuda a detectar errores comunes, pero no sustituye la revisión del commit.

La versión anterior publicada y los commits antiguos pueden permanecer en cachés o vistas directas de GitHub; cifrar esta versión no elimina copias anteriores.
