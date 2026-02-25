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

// Eventos para el laboratorio
const events = [
  {
    id: 'evt-paid-meetup',
    priceID: 'price_1Hh9ii2eZvKYlo2C0OR6n8mZ',
    name: 'HTB Meetup: Hacking de Pasarelas de Pago',
    description:
      'Encuentro de hacking y seguridad ofensiva centrado en vulnerabilidades en pasarelas de pago.',
    date: '2026-02-26',
    location: 'Escuela Politécnica de Cáceres',
    price: 20.0,
    isFree: false,
    image: 'https://www.distritok.com/blog/wp-content/uploads/2015/08/pagos-redsys.jpg'
  },
  {
    id: 'evt-distractor-1',
    priceID: 'price_dist_1_992288',
    name: 'Congreso Nacional de Macramé Avanzado',
    description:
      'Un evento único para los amantes de los nudos y las cuerdas. Aprenderás técnicas milenarias para decorar tu salón.',
    date: '2026-04-12',
    location: 'Palacio de Congresos, Madrid',
    price: 45.0,
    isFree: false,
    image: 'https://picsum.photos/seed/knots/800/400'
  },
  {
    id: 'evt-distractor-2',
    priceID: 'price_dist_2_443311',
    name: 'Simposio sobre la Reproducción del Escarabajo Pelotero',
    description:
      'Expertos internacionales debatirán sobre el impacto del cambio climático en la recolección de esferas fecales.',
    date: '2026-05-20',
    location: 'Auditorio de Ciencias, Granada',
    price: 15.0,
    isFree: false,
    image: 'https://picsum.photos/seed/beetle/800/400'
  },
  {
    id: 'evt-distractor-3',
    priceID: 'price_dist_3_112233',
    name: 'Festival del Queso que Huele Regular',
    description:
      'Degustación intensiva de los quesos más potentes del norte de Europa. Se recomienda traer pinzas para la nariz.',
    date: '2026-06-05',
    location: 'Recinto Ferial, Oviedo',
    price: 30.0,
    isFree: false,
    image: 'https://picsum.photos/seed/cheese/800/400'
  },
  {
    id: 'evt-distractor-4',
    priceID: 'price_dist_4_556677',
    name: 'Curso de Avistamiento de Ovnis en Teruel',
    description:
      'Si Teruel existe, los aliens también. Únete a nuestra expedición nocturna para mirar al cielo con esperanza.',
    date: '2026-07-15',
    location: 'Sierra de Albarracín, Teruel',
    price: 25.0,
    isFree: false,
    image: 'https://picsum.photos/seed/ufo/800/400'
  },
  {
    id: 'evt-free-community',
    priceID: 'price_free_entry_2026_htb',
    name: 'HTB Community: Introducción al Hacking',
    description:
      'Taller gratuito para principiantes en la comunidad de Hack The Box.',
    date: '2026-03-05',
    location: 'Online',
    price: 0.0,
    isFree: true,
    image: 'https://www.hackthebox.com/storage/blog/xIVoqW31w0MVuWypzBPlO1ptY5hU0cvC.jpg'
  }
];

// "Base de datos" de pedidos en memoria
const orders = [];

// Helper para buscar evento
function getEventById(eventId) {
  return events.find(e => e.id === eventId);
}

// Helper para buscar evento por priceID
function getEventByPriceId(priceID) {
  return events.find(e => e.priceID === priceID);
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

// Crear pedido y enviar al "checkout"
app.post('/event/:id/checkout', (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) {
    return res.status(404).send('Evento no encontrado');
  }

  const customerName = (req.body.customerName || '').trim();
  if (!customerName) {
    return res.status(400).send('El nombre es obligatorio.');
  }

  const quantity = parseInt(req.body.quantity || '1', 10);
  if (Number.isNaN(quantity) || quantity <= 0) {
    return res.status(400).send('Cantidad de entradas no válida');
  }

  // VULNERABILIDAD: Confiamos en el priceID que viene del cliente
  const priceID = req.body.priceID;
  const eventFromPrice = getEventByPriceId(priceID);
  
  // Si no se encuentra el priceID, usamos el del evento original (fallback)
  const effectiveEvent = eventFromPrice || event;
  const isFreeOrder = effectiveEvent.isFree;
  
  const orderId = uuidv4();
  // Si el priceID manipulado corresponde a un evento gratis, el total es 0
  const totalAmount = isFreeOrder ? 0 : event.price * quantity;

  const newOrder = {
    id: orderId,
    eventId: event.id,
    priceID: priceID,
    customerName,
    quantity,
    amount: totalAmount,
    status: 'pending',
    isFree: isFreeOrder,
    createdAt: Date.now()
  };

  orders.push(newOrder);

  res.render('layout', {
    title: 'Revisión del pedido',
    contentTemplate: 'checkout',
    event,
    order: newOrder,
    isFreeOrder
  });
});

// --- Procesamiento de pago ---

// Confirmar pedido (redirige a pasarela o procesa directamente si es gratis)
app.post('/order/:id/confirm', (req, res) => {
  const { id } = req.params;
  const order = orders.find(o => o.id === id);
  if (!order) {
    return res.status(404).send('Pedido no encontrado');
  }

  const event = getEventById(order.eventId);

  if (order.amount > 0) {
    // Si el pedido tiene coste, enviamos a la pasarela falsa donde se quedará bloqueado
    return res.render('layout', {
      title: 'Pasarela de Pago',
      contentTemplate: 'fake_gateway',
      order,
      event
    });
  } else {
    // Si el pedido es gratis (original o manipulado), permitimos avanzar al procesado final
    // Añadimos el parámetro freeTicket=true requerido para la validación
    res.redirect(`/payment/validate-order?orderId=${order.id}&freeTicket=true`);
  }
});

// --- URLs de retorno ---

// Nueva URL de éxito: requiere validación de ticket gratuito
app.get('/payment/validate-order', (req, res) => {
  const { orderId, freeTicket } = req.query;

  const order = orders.find(o => o.id === orderId);
  if (!order) {
    return res.status(404).send('Pedido no encontrado');
  }

  // Solo procesamos si el parámetro freeTicket es true
  if (freeTicket !== 'true') {
    return res.status(403).send('Error de validación: Este endpoint solo acepta tickets gratuitos.');
  }

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

// URL de error: cancelar pedido
app.get('/payment/ko', (req, res) => {
  const { orderId } = req.query;

  const order = orders.find(o => o.id === orderId);
  if (!order) {
    return res.status(404).send('Pedido no encontrado');
  }

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

