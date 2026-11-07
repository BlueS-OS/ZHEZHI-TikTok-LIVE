# Prueba de Zhezhi con Minecraft Java 1.16.1 (PrismLauncher)

Este es un mod **cliente Fabric para Minecraft 1.16.1**, no para Forge ni Bedrock. No modifica ninguna instalación de Prism por sí solo.

## Seguridad y prueba

1. En Prism, duplica la instancia `1.16.1` y **copia el mundo** que vayas a usar. No abras por primera vez un mundo importante con el mod.
2. En la copia: **Editar → Versión → Instalar Fabric** para Minecraft 1.16.1. Usa una versión compatible de Fabric Loader (el proyecto se compiló contra `0.16.14`).
3. Coloca el archivo `build/libs/zhezhi-minecraft-1161-0.1.0.jar` en la carpeta `minecraft/mods` de la **copia**. No hace falta Fabric API.
4. Inicia Zhezhi (por defecto en el puerto local `5180`) y abre la copia de Minecraft con **un solo jugador** en un mundo individual. El mod consulta exclusivamente `http://127.0.0.1:5180` cada 2 segundos; si Zhezhi está cerrado, el juego sigue normalmente. Si usas otro puerto, indícalo con la propiedad `-Dzhezhi.port=TU_PUERTO` o la variable de entorno `ZHEZHI_PORT`; solo se aceptan valores entre `1024` y `65535`.
5. En Zhezhi, entra en el apartado **Minecraft** y activa **Permitir acciones en Minecraft**. Para velocidad, zombi clásico y votos, activa también **Overlay → Acciones de espectadores** y las casillas individuales. Para los mobs personalizados, crea una acción en **Minecraft → Reglas de mobs** y actívala; estas reglas no dependen de las animaciones. Prueba en modo demo únicamente en el mundo copiado. La pausa de Zhezhi detiene acciones nuevas. Si el panel pide reiniciar Zhezhi, detén antes el demo: el servidor abierto aún usa la versión anterior.

Acciones cerradas: corazones → velocidad de 10 segundos; regalo con suficientes diamantes → un zombi a tres bloques; votación `!a` → día, `!b` → noche (máximo una vez cada 30 segundos). No admite comandos libres del chat. Si más de un jugador entra al mundo (por ejemplo, al abrirlo a LAN), no ejecuta acciones. Solo entrega acciones frescas mientras el mod está consultando; no se acumulan para cuando vuelvas a abrir el juego.

Reglas de mobs: puedes elegir entre una lista amplia de mobs hostiles, pasivos y neutrales (zombi, esqueleto, creeper, araña, ahogado, piglin, vaca, cerdo, gallina, lobo, aldeano, etc.). Los eventos pueden ser likes acumulados, regalos (mínimo de diamantes y nombre opcional), seguimientos o un comentario configurado. La **cantidad por regla es de 1 a 20**: por ejemplo, `Rosa` puede generar cinco creepers. El nombre visible puede ser el del espectador, el comentario en la regla de chat, o ninguno. El comentario **nunca se interpreta como comando**. Se limitan a 12 reglas, 20 mobs en total por evento y por consulta del mod (de ellos como máximo cinco jefes), cuatro acciones pendientes y un enfriamiento de al menos tres segundos por regla. Las reglas nuevas nacen desactivadas; evita activarlas con un demo rápido para no llenar el mundo.

La regla de chat puede elegir explícitamente **comentario exacto** o **cualquier comentario**; los mensajes ocultos o vacíos no cuentan. Wither, dragón del End y guardián anciano están disponibles solo para mundos de prueba copiados: **los dos primeros pueden destruir construcciones**. El dragón también se puede intentar generar fuera del End si hay espacio libre; el guardián anciano requiere agua profunda. Warden **no existe en 1.16.1** y este mod lo rechaza. Los jefes permiten de uno a cinco por evento y consulta, con enfriamiento editable (se recomiendan 60 segundos o más). El dragón de 1.16.1 aún requiere comprobación en el juego con este ajuste.

Para el dragón busca una zona **amplia y abierta** delante del jugador; el mod intenta colocarlo elevado en el aire, también sobre terreno irregular. Si no hay espacio libre o línea de visión, no lo genera. No se ha verificado en el juego con este ajuste.

Explosivos opcionales: **TNT encendida** (mecha de unos cuatro segundos), **cristal del End** (explota al recibir daño) y **cristal del End automático** (se detona tras dos segundos). Son acciones cerradas, no comandos del chat; puedes elegirlas en el selector de la regla. Tienen un límite independiente de 20 explosivos por evento y por consulta del mod; las reglas nuevas siguen apagadas. El mod solo los coloca ante el jugador si encuentra suelo, espacio libre y línea de visión. **Pueden destruir bloques y encadenar explosiones**: úsalos únicamente en mundos copiados. No se han probado dentro del juego.

Si hay una regla de regalo personalizada activa, sustituye al zombi clásico de regalos (la animación del overlay puede seguir funcionando). El mob personalizado busca un hueco libre con suelo **delante y a la vista** del jugador; si no hay espacio visible, no aparece en lugar de quedarse atrapado o surgir detrás de paredes.

Para reconstruir el mod, con JDK 17 y Gradle 8.6 ejecuta `gradle build` en este directorio. El archivo en `build/libs` se genera localmente; no se sube al repositorio.

Para Minecraft 26.3 hay una adaptación en [`../minecraft-26.3/`](../minecraft-26.3/README.md). Úsala también solo en una copia del mundo.
