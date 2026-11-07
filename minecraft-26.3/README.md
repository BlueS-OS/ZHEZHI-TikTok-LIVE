# Puente Zhezhi para Minecraft Java 26.3

Proyecto **separado** del mod 1.16.1. Requiere Fabric Loader 0.20.1 o posterior y Java 25. Compila con Gradle 9.8.2 (`gradle build`); el `.jar` se genera en `build/libs/` y no se publica.

Instala el `.jar` **solo** en una copia de la instancia 26.3 de Prism con Fabric. No sustituyas el mod 1.16.1 ni coloques ambos en la misma instancia. Abre un mundo individual copiado y Zhezhi en `127.0.0.1:5180`. El mod no conecta con servidores ni acepta comandos procedentes del chat: únicamente aplica una lista cerrada de efectos y mobs. Las etiquetas son texto y tienen un máximo de 48 caracteres. Si Zhezhi está cerrado, Minecraft sigue funcionando normalmente.

En Zhezhi, usa la pestaña **Minecraft**. Activa «Permitir acciones en Minecraft» y una regla de mob. Las acciones clásicas del overlay siguen teniendo sus propias casillas. Las reglas creadas para 1.16.1 son compartidas por Zhezhi; al probar la instancia 26.3, pausa el demo y evita tener las dos instancias abiertas a la vez para que los eventos no se mezclen.

Cada regla permite de **1 a 20 mobs por evento**. Escribe `Rosa` como nombre exacto del regalo para que solo ese regalo los genere. Hay un máximo global de 20 mobs por evento y por consulta del mod; las reglas antiguas conservan su cantidad. El enfriamiento evita ráfagas continuas.

También puedes seleccionar **cualquier comentario** en una regla de chat (en lugar del comentario exacto); los mensajes ocultos o vacíos no disparan acciones. Los jefes Wither, dragón del End, Warden y guardián anciano son peligrosos: solo deben usarse en copias de mundos. El dragón se puede intentar generar en cualquier dimensión con espacio libre; el guardián anciano requiere agua profunda. Hasta cinco jefes por evento y consulta, dentro del máximo global de 20 mobs, y enfriamiento editable (se recomiendan 60 segundos o más). Las reglas nuevas empiezan apagadas.

Para el dragón, busca una zona **amplia, abierta y con suelo** delante del jugador; el mod lo intenta colocar elevado sobre ella. Conserva las comprobaciones de colisión y visibilidad y, si no encuentra un sitio seguro, no lo genera. Esta corrección aún no se ha comprobado en el juego.

Explosivos opcionales en el editor de reglas: **TNT encendida** (mecha de unos cuatro segundos), **cristal del End** (explota al recibir daño) y **cristal del End automático** (se detona tras dos segundos). Hay un máximo independiente de 20 explosivos por evento y por consulta del mod; las reglas nuevas nacen apagadas. Solo se colocan ante el jugador cuando hay suelo, espacio libre y línea de visión. **Pueden destruir bloques y encadenar explosiones**: úsalos exclusivamente en mundos copiados. No se han probado dentro del juego.
