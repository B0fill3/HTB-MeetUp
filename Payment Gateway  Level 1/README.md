## Laboratorio: Pasarela de Pagos Redsys Vulnerable (Node/Express)

### Descripción general

Este laboratorio implementa una **tienda de entradas de eventos** escrita en **Node.js + Express + EJS** que integra una pasarela de pagos tipo **Redsys emulada**.

La aplicación está pensada para demostrar un fallo de lógica muy común en integraciones de pagos: **la confirmación del pedido se realiza en la URL de retorno al usuario (URLOK) en lugar de en el webhook de notificación del proveedor de pagos**.

Como resultado, un atacante que consiga los parámetros enviados a la pasarela (por ejemplo, interceptando la petición desde el navegador) puede:

- Decodificar el valor Base64 de `Ds_MerchantParameters`.
- Obtener la URL de éxito `Ds_Merchant_UrlOK`.
- Visitar directamente esa URL **sin haber pagado** y conseguir que el sistema marque el pedido como pagado igualmente.

### Tecnologías

- `Node.js`
- `Express`
- `EJS` como motor de plantillas
- Dependencias auxiliares: `body-parser`, `uuid`, `nodemon` (desarrollo)

---

### Estructura básica

- `app.js`: servidor principal Express y rutas.
- `views/`:
  - `layout.ejs`: layout principal.
  - `index.ejs`: listado de eventos.
  - `event.ejs`: detalle del evento y formulario de compra.
  - `checkout.ejs`: revisión del pedido y envío de parámetros a la pasarela.
  - `redsys.ejs`: pasarela Redsys emulada.
  - `order_success.ejs`: pantalla de pedido completado.
  - `order_error.ejs`: pantalla de pedido cancelado.
  - `admin_orders.ejs`: panel simple para ver pedidos (para el formador).

Los datos (eventos y pedidos) se guardan **en memoria**, por simplicidad del laboratorio. Si reinicias el servidor, se pierden.

Actualmente solo existe **un evento** en el sistema:

- Nombre: `HTB Meetup: Seguridad en Pasarelas de Pago`
- Precio: `20 €` por entrada

---

### Instalación y ejecución

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Arranca el servidor (modo normal):

   ```bash
   npm start
   ```

   O en modo desarrollo con recarga automática:

   ```bash
   npm run dev
   ```

3. Abre el navegador en:

   ```text
   http://localhost:3000
   ```

---

### Flujo de compra (legítimo)

1. El usuario entra en la página principal (`/`) y ve el evento disponible.
2. Accede al detalle del evento (`/event/:id`) y elige el número de entradas.
3. Envía el formulario y se crea un **pedido en estado `pending`**:
   - Ruta: `POST /event/:id/checkout`
4. El sistema genera los parámetros tipo Redsys:
   - `Ds_Merchant_Amount`
   - `Ds_Merchant_Order`
   - `Ds_Merchant_UrlOK`
   - `Ds_Merchant_UrlKO`
   - etc.
5. Estos parámetros se serializan a JSON, se codifican en Base64 en
   `Ds_MerchantParameters` y se envían por `POST` a:
   - Ruta: `POST /redsys/pay`
6. La página `redsys.ejs` simula la pasarela:
   - Muestra (solo en el laboratorio) el contenido decodificado de `Ds_MerchantParameters`.
   - Tiene botones de **"Simular pago correcto"** y **"Simular pago cancelado"**:
     - El botón de pago correcto redirige a `Ds_Merchant_UrlOK`.
     - El botón de cancelación redirige a `Ds_Merchant_UrlKO`.
7. Si el flujo es "legítimo":
   - El usuario pulsa "Simular pago correcto".
   - Es redirigido a `/payment/ok?...`.
   - El servidor marca el pedido como `paid`.
   - Se muestra la pantalla de confirmación (`order_success.ejs`).

Puedes observar el estado de todos los pedidos en:

```text
http://localhost:3000/admin/orders
```

---

### Detalle de la vulnerabilidad

En una integración segura, la lógica que marca un pedido como pagado debería estar en el **webhook de notificación del proveedor de pagos** (en este caso sería algo como `POST /redsys/notify`), validando:

- La firma de la pasarela.
- El importe.
- El identificador del pedido.
- El estado de la transacción.

Sin embargo, en este laboratorio:

- El endpoint `POST /redsys/notify` **no hace nada relevante** (solo log/OK).
- La lógica de finalización del pedido está en:
  - `GET /payment/ok`
- Este endpoint:
  - Recibe `orderId` por query string.
  - Busca el pedido en memoria.
  - **Marca el pedido como `paid` sin comprobar nada más**:
    - No comprueba firma.
    - No comprueba si la petición viene realmente de Redsys.
    - No comprueba si el pago se ha realizado.

Como la URL de éxito `Ds_Merchant_UrlOK` se incluye dentro de
`Ds_MerchantParameters` (JSON -> Base64), cualquier atacante que pueda ver esos
parámetros puede recuperar la URL y forzar la finalización del pedido.

---

### Escenario de ataque paso a paso

Este es un ejemplo de cómo un atacante podría explotar la vulnerabilidad:

1. **Crear un pedido pendiente**:
   - Entrar en `http://localhost:3000`.
   - Entrar al evento y seleccionar, por ejemplo, 1 entrada.
   - Pulsar "Ir al pago".

2. **Capturar `Ds_MerchantParameters`**:
   - En el entorno del laboratorio es cómodo verlos en la propia página
     `checkout.ejs` (se muestran dentro de un `<details>`).
   - En un escenario más realista se podrían capturar con:
     - Un proxy tipo Burp, ZAP, etc.
     - Las herramientas de desarrollador del navegador (Network > Peticiones).

3. **Decodificar `Ds_MerchantParameters`**:
   - Copiar el valor Base64.
   - Decodificarlo (por ejemplo, en consola de Node):

     ```bash
     node -e "console.log(JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8')))" 'BASE64_AQUI'
     ```

   - El resultado será un JSON que incluye, entre otros:
     - `Ds_Merchant_UrlOK`
     - `Ds_Merchant_UrlKO`

4. **Usar directamente la URLOK**:
   - Copiar el valor de `Ds_Merchant_UrlOK`, que será algo como:

     ```text
     http://localhost:3000/payment/ok?orderId=...&amount=...
     ```

   - **Visitar esa URL directamente en el navegador**, sin pasar por la pantalla
     de pago ni pulsar "Simular pago correcto".

5. **Efecto**:
   - El servidor marcará el pedido como `paid`.
   - La pantalla mostrará que el pedido está pagado.
   - En `/admin/orders` el pedido aparecerá en estado **PAGADO**.

En resumen: basta con conocer la URLOK para **marcar un pedido como pagado sin
haber realizado ningún pago real**.

---

### Cómo debería hacerse de forma segura (conceptual)

Aunque este laboratorio está diseñado para ser vulnerable, a nivel conceptual lo
correcto sería:

- Que la lógica de cambio de estado del pedido (de `pending` a `paid`) ocurra
  en el **webhook**:
  - `POST /redsys/notify`
- Validar en el servidor:
  - La firma (`Ds_Signature`) usando la clave secreta compartida con Redsys.
  - Que el importe (`Ds_Merchant_Amount`) coincida con el del pedido.
  - Que el identificador del pedido es válido y está en estado `pending`.
  - Que el código de resultado indica éxito.
- Hacer que la URLOK (`/payment/ok`) solamente muestre información al usuario
  (pantalla bonita de "pedido ya pagado"), pero **no cambie estado alguno**.

Este laboratorio puede servir como base para, en una siguiente fase, implementar
la versión segura y compararla con la vulnerable.

