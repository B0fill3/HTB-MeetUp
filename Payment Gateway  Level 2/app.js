const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Datos en memoria (no persistentes) ---

// Solo un evento para el laboratorio
const events = [
  {
    id: 'evt-htb-meetup',
    name: 'HTB Meetup: Hacking de Pasarelas de Pago',
    description:
      'Encuentro de hacking y seguridad ofensiva centrado en vulnerabilidades en pasarelas de pago.',
    imageUrl: 'https://www.hackthebox.com/storage/blog/ps6M2yuPqVVh4iVo20nlZFVRifbAv7A3.jpg',
    date: '2026-02-26',
    location: 'Escuela Politécnica de Cáceres',
    price: 20.0 // precio por entrada
  }
];

// "Base de datos" de pedidos en memoria
const orders = [];

// Helper para buscar evento
function getEventById(eventId) {
  return events.find(e => e.id === eventId);
}

// --- Rutas de la tienda ---

// Página principal con listado de eventos
app.get('/', (req, res) => {
  res.render('layout', {
    title: 'Eventos disponibles',
    contentTemplate: 'index',
    events
  });
});

// Detalle de evento y formulario de compra
app.get('/event/:id', (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) {
    return res.status(404).send('Evento no encontrado');
  }
  res.render('layout', {
    title: event.name,
    contentTemplate: 'event',
    event
  });
});

// Crear pedido y enviar al "checkout" (previo a pasarela)
app.post('/event/:id/checkout', (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) {
    return res.status(404).send('Evento no encontrado');
  }

  const customerName = (req.body.customerName || '').trim();
  if (!customerName) {
    return res.status(400).send('El nombre de la persona que realiza el pedido es obligatorio.');
  }

  const quantity = parseInt(req.body.quantity || '1', 10);
  if (Number.isNaN(quantity) || quantity <= 0) {
    return res.status(400).send('Cantidad de entradas no válida');
  }

  const orderId = uuidv4();
  const totalAmount = event.price * quantity;

  const newOrder = {
    id: orderId,
    eventId: event.id,
    customerName,
    quantity,
    amount: totalAmount,
    status: 'pending', // pending | paid | cancelled
    createdAt: Date.now()
  };
  console.log("Order id: ", orderId);
  console.log("newOrder.id: ", newOrder.id);

  orders.push(newOrder);

  // --- Emulación de parámetros Redsys ---
  const merchantParameters = {
    Ds_Merchant_Amount: `${Math.round(totalAmount * 100)}`, // en céntimos
    Ds_Merchant_Order: orderId,
    Ds_Merchant_MerchantCode: '999888777',
    Ds_Merchant_Currency: '978',
    Ds_Merchant_TransactionType: '0',
    // VULNERABILIDAD: La lógica de finalización del pedido está en URLOK
    Ds_Merchant_UrlOK: `${config.baseUrl}/payment/ok?orderId=${encodeURIComponent(
      orderId
    )}&amount=${encodeURIComponent(totalAmount.toFixed(2))}`,
    Ds_Merchant_UrlKO: `${config.baseUrl}/payment/ko?orderId=${encodeURIComponent(
      orderId
    )}`
  };

  const merchantParametersJson = JSON.stringify(merchantParameters);
  const Ds_MerchantParameters = Buffer.from(
    merchantParametersJson,
    'utf8'
  ).toString('base64');

  // Nota: en la vida real se firma, aquí lo omitimos
  const Ds_SignatureVersion = 'HMAC_SHA256_V1';
  const Ds_Signature = 'FAKE_SIGNATURE';

  res.render('layout', {
    title: 'Revisión del pedido',
    contentTemplate:'checkout', event,
    order: newOrder,
    Ds_SignatureVersion,
    Ds_MerchantParameters,
    Ds_Signature,
    merchantParametersJson // útil para entender el laboratorio (no visible en la vida real)
  });
});

// --- Pasarela Redsys emulada ---

// Endpoint al que se envían los parámetros Redsys desde el comercio
// y donde se simula la introducción de datos de tarjeta.
app.post('/redsys/pay', (req, res) => {
  const {
    Ds_MerchantParameters,
    Ds_Signature,
    Ds_SignatureVersion,
    cardNumber
  } = req.body;

  if (!Ds_MerchantParameters) {
    return res
      .status(400)
      .send('Faltan parámetros de comercio (Ds_MerchantParameters).');
  }

  // En este laboratorio NO validamos nada, solo decodificamos para mostrar
  let decodedParams = {};
  try {
    const json = Buffer.from(Ds_MerchantParameters, 'base64').toString('utf8');
    decodedParams = JSON.parse(json);
  } catch (e) {
    return res
      .status(400)
      .send('Error al decodificar Ds_MerchantParameters (laboratorio).');
  }

  // Si viene cardNumber significa que el usuario ha intentado pagar:
  // siempre respondemos con error de datos incorrectos.
  const errorMessage = cardNumber
    ? 'Los datos de la tarjeta no han podido ser validados por su entidad emisora. Por favor, revise la información o utilice otro método de pago.'
    : null;

  res.render('redsys_page', {
    Ds_MerchantParameters,
    Ds_SignatureVersion,
    Ds_Signature,
    decodedParams,
    errorMessage
  });
});

// Webhook de notificación de Redsys (en la vida real iría aquí la lógica segura)
// Aquí lo dejamos vacío o solo para logging para remarcar la vulnerabilidad.
app.post('/redsys/notify', (req, res) => {
  console.log('Notificación Redsys recibida (NO utilizada en este laboratorio).');
  // Simplemente respondemos OK
  res.send('OK');
});

// --- URLs de retorno (donde está la vulnerabilidad) ---

// URLOK: aquí se finaliza el pedido (vulnerable)
app.get('/payment/ok', (req, res) => {
  const { orderId } = req.query;

  const order = orders.find(o => o.id === orderId);
  if (!order) {
    return res.status(404).send('Pedido no encontrado');
  }

  // VULNERABILIDAD:
  // No se comprueba que la petición venga realmente de Redsys,
  // ni firma, ni que se haya pagado nada. Simplemente se marca como pagado.
  if (order.status !== 'paid') {
    order.status = 'paid';
    order.paidAt = Date.now();
  }

  // Calcular la posición en el marcador (orden de éxito)
  const paidOrders = orders
    .filter(o => o.status === 'paid' && o.paidAt)
    .sort((a, b) => a.paidAt - b.paidAt);

  const rankingPosition =
    paidOrders.findIndex(o => o.id === order.id) >= 0
      ? paidOrders.findIndex(o => o.id === order.id) + 1
      : null;

  const event = getEventById(order.eventId);

  res.render('layout', {
    title: 'Pedido completado',
    contentTemplate: 'order_success',
    order,
    event,
    rankingPosition
  });
});

// URLKO: cancelar pedido
app.get('/payment/ko', (req, res) => {
  const { orderId } = req.query;

  const order = orders.find(o => o.id === orderId);
  if (!order) {
    return res.status(404).send('Pedido no encontrado');
  }

  //order.status = 'cancelled';
  const event = getEventById(order.eventId);

  res.render('layout', {
    title: 'Pago cancelado',
    contentTemplate: 'order_error',
    order,
    event
  });
});

// --- Ruta de "panel" sencillo para ver pedidos (útil para el formador) ---
app.get('/admin/orders', (req, res) => {
  // Calcular ranking para pedidos pagados
  const paidOrders = orders
    .filter(o => o.status === 'paid' && o.paidAt)
    .sort((a, b) => a.paidAt - b.paidAt);

  const rankingMap = new Map();
  paidOrders.forEach((o, index) => {
    rankingMap.set(o.id, index + 1);
  });

  const enrichedOrders = orders.map(o => ({
    ...o,
    event: getEventById(o.eventId),
    rankingPosition: rankingMap.get(o.id) || null
  }));

  // Ordenar por timestamp de pago (primero pagados por orden de éxito)
  enrichedOrders.sort((a, b) => {
    const aPaidAt = a.paidAt ?? Infinity;
    const bPaidAt = b.paidAt ?? Infinity;
    if (aPaidAt !== bPaidAt) {
      return aPaidAt - bPaidAt;
    }
    // Desempate por fecha de creación si existe
    const aCreated = a.createdAt ?? Infinity;
    const bCreated = b.createdAt ?? Infinity;
    return aCreated - bCreated;
  });
  res.render('layout', {
    title: 'Pedidos (admin)',
    contentTemplate: 'admin_orders',
    orders: enrichedOrders
  });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en ${config.baseUrl}`);
});

