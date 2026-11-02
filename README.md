# ZHEZHI · asistente de chat para TikTok LIVE

Un estudio local para seguir el chat en vivo, anunciar eventos con voz y crear alertas personalizadas para tu directo.

**Chat en vivo · Voz · Alertas · Overlay · Moderación**

Identidad visual inspirada en [Zhezhi2Uploader](https://github.com/BlueS-OS/Zhezhi2Uploader): su sello 折 y su paleta de tinta, malaquita y bermellón, adaptados a un panel oscuro.

Zhezhi muestra comentarios y eventos del directo, anuncia seguidores y suscripciones y lee el chat en voz alta. El asistente funciona en tu PC; no modifica TikTok LIVE Studio. La conexión de lectura usa `tiktok-live-connector`, una integración no oficial que puede dejar de funcionar si TikTok cambia su servicio.

## Empezar en Windows

1. Descarga el proyecto con **Code → Download ZIP** en GitHub y extrae la carpeta. Instala [Node.js 20 o posterior](https://nodejs.org/) si aún no lo tienes.
2. Dentro de la carpeta extraída, haz doble clic en **Iniciar Zhezhi.bat**. Si faltan dependencias, las instalará automáticamente (necesitas Internet la primera vez); si ya están, abrirá Zhezhi directamente. También puedes usar **Instalar Zhezhi.bat**: comprueba lo que falta y abre Zhezhi al terminar. No ejecutes el instalador durante un directo.
3. El panel estará en <http://127.0.0.1:5180/>. También puedes iniciar con `node server.js` si ya instalaste las dependencias.
4. Introduce tu usuario de TikTok en **Conexión** (sin `@`) y pulsa **Conectar** cuando estés en directo. Si no estás en vivo, utiliza **Modo demo** para comprobar las alertas y la voz.
   Si sale «No pude encontrar el Room ID», comprueba que `https://www.tiktok.com/@TUUSUARIO/live` se abre en una ventana privada mientras transmites. Si se abre, espera un minuto e inténtalo de nuevo: TikTok puede limitar las consultas de la integración no oficial. Si ya conoces el **Room ID numérico**, puedes introducirlo en Conexión para omitir esa búsqueda; no confundas el Room ID con tu usuario.
   Si aparece un error de firma, pulsa **Diagnosticar conexión** después del intento fallido. Mostrará si este proceso puede acceder a TikTok y a Euler Stream, además del tipo y código del último error, sin exponer tus cookies ni claves. Reinicia Zhezhi tras actualizar sus archivos para que aparezca esta opción.
5. En **Voz**, deja activado **Escuchar también en este panel** para escuchar los mensajes en tu PC. Pulsa **Probar voz**; si el navegador bloquea el audio, haz clic en la página y vuelve a probar. Puedes cambiar el motor a **Windows (local)** si la voz Edge no está disponible.
   Si tienes **VoiceStudio** instalado, ábrelo primero, espera a que cargue su API local y elige **VoiceStudio (local, opcional)** en Motor. Pulsa **Detectar voces de VoiceStudio**, selecciona un perfil o deja la voz predeterminada y usa **Probar voz**. El puerto habitual es `3900`; `tts-1` usa el motor activo de VoiceStudio. Debes tener un modelo de voz instalado en VoiceStudio; Zhezhi no descarga modelos automáticamente. Si VoiceStudio falla, se usará la voz de Windows.
   Los audios de voz en `cache/tts` son temporales: Zhezhi revisa la carpeta cada minuto, borra los archivos de más de 10 minutos y limita la caché a 30 archivos o 12 MB. Conserva al menos 2 minutos para que el panel y el overlay terminen de reproducirlos; durante ese margen puede superar los límites temporalmente. No afecta a los audios personalizados de `data/alerts`.
6. En LIVE Studio, habilita la captura de audio del escritorio si quieres que los espectadores oigan a Zhezhi. Si tu versión permite añadir una página web como fuente, puedes copiar la URL del apartado **Overlay**. No captures el audio del panel y del overlay a la vez para evitar duplicados.

### Audios opcionales de seguidores y regalos

En **Overlay → Audios para seguidores y regalos**, carga por separado un MP3 o WAV (máximo 12 MB) para **Al seguir** y **Al donar un regalo**. Activa **Audios personalizados** para que suenen en el panel y el overlay cuando ocurra cada evento; puedes desactivar uno de los dos tipos o ajustar el volumen. Los botones **Escuchar** prueban el archivo aunque la opción esté desactivada; **Seguidor** y **Regalo** en Pruebas simulan el evento completo. Los archivos quedan en `data/alerts` en tu PC.

La función está desactivada por defecto. **No sustituye la lectura con voz**: Zhezhi seguirá anunciando seguidores y regalos si **Voz → Anunciar seguidores, subs y regalos** está activado. Si capturas panel y overlay al mismo tiempo, los sonidos se oirán duplicados; usa solo una fuente de audio.

Para ver solo los avisos en pantalla, usa la URL **Solo alertas**. Para ver subtítulos sin chat ni alertas, usa **Solo subtítulos de voz**. Las respuestas al chat son sugerencias por defecto; para enviar mensajes automáticamente necesitas configurar las credenciales indicadas en **Ajustes**. No compartas `config.json`, pues puede contener claves o cookies.

Si el puerto 5180 está ocupado, cierra las otras ventanas de Zhezhi antes de volver a abrirlo. El programa no abre una segunda copia en otro puerto para evitar que el navegador quede conectado a una versión anterior.
