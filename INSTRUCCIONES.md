# Runas Mágicas — Guía de publicación

## 1. Pegar las reglas de seguridad en Firebase

1. Entrá a [console.firebase.google.com](https://console.firebase.google.com) → proyecto `nyxar-runas`.
2. Menú izquierdo → **Compilación** → **Firestore Database** → pestaña **Reglas**.
3. Borrá lo que haya y pegá todo el contenido de `firestore.rules.txt` (la parte después de los comentarios).
4. Click en **Publicar**.

Sin este paso la base de datos rechaza todo y nadie va a poder registrarse ni canjear códigos.

## 2. Subir la carpeta a GitHub

1. Creá un repositorio nuevo en GitHub (puede ser público o privado, no importa).
2. Arrastrá **todo el contenido de esta carpeta** (no la carpeta en sí, sino lo que hay dentro: `index.html`, `admin.html`, `manifest.json`, `sw.js`, `firestore.rules.txt`, y las subcarpetas `css/`, `js/`, `assets/`) a la página de subida de archivos de GitHub. El uploader web de GitHub sí respeta las subcarpetas si arrastrás la carpeta completa.
3. Hacé commit.
4. Repo → **Settings** → **Pages** → en "Branch" elegí `main` y la carpeta `/ (root)` → **Save**.
5. GitHub te va a dar una URL parecida a `https://tu-usuario.github.io/tu-repo/`. Puede tardar 1-2 minutos en activarse.

## 3. Autorizar el dominio en Firebase (paso crítico)

1. En Firebase console → **Authentication** → pestaña **Settings** → **Authorized domains**.
2. Click en **Agregar dominio** y pegá el dominio de tu GitHub Pages, por ejemplo `tu-usuario.github.io` (sin `https://` ni la barra final).
3. Guardá.

Si te saltás este paso, el login y el registro van a fallar en el sitio publicado aunque funcionen perfecto en local — Firebase bloquea por defecto cualquier dominio que no esté en esta lista.

## 4. Probar todo

- Abrí la URL de GitHub Pages, creá una cuenta de prueba, y verificá que el círculo de runas aparece vacío.
- Entrá a `tu-url/admin.html`, iniciá sesión con `nyxar.sv@gmail.com`, generá un código.
- Volvé a la cuenta de prueba y canjeá ese código — debería sumar una runa.
- Repetí hasta 6 para que aparezca el botón de girar la ruleta.
- Marcá el premio como entregado desde el panel admin y confirmá que el estado cambia en la cuenta del cliente.

## 5. Cómo usarlo en el día a día

- **Generar código**: panel admin → botón "Generar código nuevo" → copiás y lo mandás por DM al cliente después de su compra.
- **Premios pendientes**: cuando alguien gana algo en la ruleta aparece ahí. Cuando ya le entregaste el premio en persona, le das click a "Marcar entregado".
- **Clientes**: te deja ver cuántas runas tiene cada uno y cuántos giros le quedan pendientes, por si alguien pregunta.

## 6. Instalar como app en el celular (para tus clientes)

En Chrome (Android) o Safari (iPhone), al entrar al sitio les va a aparecer la opción de "Agregar a pantalla de inicio" / "Instalar app". Quedaría con el ícono de la runa como cualquier otra app.

## 7. Una limitación que tenés que saber

Como todo esto corre gratis sin necesidad de tarjeta, no hay un servidor intermedio validando cada giro de ruleta — la lógica corre en el navegador del cliente, protegida por las reglas de Firestore. Para alguien sin conocimientos técnicos esto es completamente seguro. Para alguien muy mañoso con conocimientos de programación, en teoría existe una forma de intentar forzar un resultado editando directamente la base de datos desde la consola del navegador.

La protección real contra esto es que **vos entregás los premios a mano**. Antes de entregar algo, especialmente un premio raro como la prenda personalizada, podés revisar en el panel admin el historial de esa persona (cuántos códigos canjeó, cuántos giros le tocan) y si algo no cuadra, simplemente no se lo entregás. A tu escala actual el riesgo real es prácticamente nulo.

Si en el futuro el negocio crece mucho y querés cerrar esto del todo, la solución sería mover la lógica de canje y giro a una función de servidor (por ejemplo Cloudflare Workers, que es gratis y no pide tarjeta). No es necesario ahora.
