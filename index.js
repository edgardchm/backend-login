const cors = require('cors');
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({
    origin: true, // Permite todos los orígenes
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query(
      'SELECT * FROM usuarios WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      console.log('Usuario no encontrado:', email);
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const user = result.rows[0];
    console.log('Usuario encontrado:', user.email);
    console.log('Password recibido:', password);
    console.log('Hash en DB:', user.password_hash);

    const match = await bcrypt.compare(password, user.password_hash);
    console.log('Resultado comparación bcrypt:', match);

    if (!match) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    res.json({ id: user.id, email: user.email, rol: user.rol, nombre: user.nombre });
  } catch (err) {
    console.error('Error interno:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener todos los tipos de repuestos
app.get('/repuestos', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tipos_repuestos ORDER BY nombre');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los tipos de repuestos' });
  }
});

// Agregar un tipo de repuesto
app.post('/repuestos', async (req, res) => {
  const { nombre } = req.body;

  try {
    const tipoResult = await db.query(
      'INSERT INTO tipos_repuestos (nombre) VALUES ($1) RETURNING id',
      [nombre]
    );

    const tipoRepuestoId = tipoResult.rows[0].id;

    await db.query(
      'INSERT INTO marca_tipo_repuesto (marca_id, tipo_repuesto_id) SELECT id, $1 FROM marcas ON CONFLICT DO NOTHING',
      [tipoRepuestoId]
    );

    res.json({ message: 'Tipo de repuesto creado y vinculado a todas las marcas', tipoRepuestoId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el tipo de repuesto' });
  }
});


// Eliminar un tipo de repuesto por ID
app.delete('/repuestos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM tipos_repuestos WHERE id = $1', [id]);
    res.json({ message: 'Repuesto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el repuesto' });
  }
});

// Obtener todas las marcas
app.get('/marcas', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM marcas ORDER BY marca');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las marcas' });
  }
});

// Crear nueva marca
app.post('/marcas', async (req, res) => {
  const { marca } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO marcas (marca) VALUES ($1) RETURNING *',
      [marca]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agregar la marca (puede que ya exista)' });
  }
});

// Editar marca por ID
app.put('/marcas/:id', async (req, res) => {
  const { id } = req.params;
  const { marca } = req.body;
  try {
    const result = await db.query(
      'UPDATE marcas SET marca = $1 WHERE id = $2 RETURNING *',
      [marca, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar la marca' });
  }
});

// Eliminar marca por ID
app.delete('/marcas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM marcas WHERE id = $1', [id]);
    res.json({ message: 'Marca eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la marca' });
  }
});

// Obtener todos los repuestos (con marca y tipo)
app.get('/repuestos-marca', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.*, m.marca, tr.nombre AS tipo
      FROM repuestos r
      JOIN marcas m ON r.marca_id = m.id
      JOIN tipos_repuestos tr ON r.tipo_repuesto_id = tr.id
      ORDER BY tr.nombre, m.marca, r.nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los repuestos' });
  }
});

const generarSKU = (nombreTipo, nombreMarca) => {
  const tipo = nombreTipo.slice(0, 3).toUpperCase();
  const marca = nombreMarca.slice(0, 3).toUpperCase();
  const random = Math.floor(1000 + Math.random() * 9000); // 4 dígitos aleatorios
  return `${tipo}-${marca}-${random}`;
};

// Crear nuevo repuesto
app.post('/repuestos-marca', async (req, res) => {
  const { nombre, descripcion, precio, precio_mayor, precio_cliente, tipo_repuesto_id, marca_id, stock } = req.body;

  try {
    // Obtener nombre de tipo y marca para el SKU
    const tipoRes = await db.query('SELECT nombre FROM tipos_repuestos WHERE id = $1', [tipo_repuesto_id]);
    const marcaRes = await db.query('SELECT marca FROM marcas WHERE id = $1', [marca_id]);

    if (tipoRes.rows.length === 0 || marcaRes.rows.length === 0) {
      return res.status(400).json({ error: 'Tipo o Marca no encontrada' });
    }

    const sku = generarSKU(tipoRes.rows[0].nombre, marcaRes.rows[0].marca);

    const result = await db.query(
      `INSERT INTO repuestos 
        (nombre, descripcion, precio, precio_mayor, precio_cliente, tipo_repuesto_id, marca_id, sku, stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [nombre, descripcion, precio, precio_mayor, precio_cliente, tipo_repuesto_id, marca_id, sku, stock]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear el repuesto:', err);
    res.status(500).json({ error: 'Error al crear el repuesto' });
  }
});


// Eliminar repuesto por ID
app.delete('/repuestos-marca/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM repuestos WHERE id = $1', [id]);
    res.json({ message: 'Repuesto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el repuesto' });
  }
});

// Obtener marcas disponibles para un tipo de repuesto específico
app.get('/marcas-por-tipo/:tipoRepuestoId', async (req, res) => {
  const { tipoRepuestoId } = req.params;
  console.log('tipoRepuestoId recibido:', tipoRepuestoId);
  try {
    const result = await db.query(`
      SELECT m.id, m.marca, t.nombre AS tipo_repuesto
      FROM marcas m
      JOIN marca_tipo_repuesto mt ON m.id = mt.marca_id
      JOIN tipos_repuestos t ON mt.tipo_repuesto_id = t.id
      WHERE t.id = $1
    `, [tipoRepuestoId]);
    console.log('Cantidad de resultados:', result.rowCount);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las marcas' });
  }
});

// Obtener repuestos por tipo y marca (tabla corregida)
app.get('/repuestos/:tipoRepuestoId/:marcaId', async (req, res) => {
  const { tipoRepuestoId, marcaId } = req.params;
  try {
    const result = await db.query(`
      SELECT id, nombre, precio_mayor, precio_cliente, stock
      FROM repuestos
      WHERE tipo_repuesto_id = $1 AND marca_id = $2
      ORDER BY nombre
    `, [tipoRepuestoId, marcaId]);    
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los repuestos' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
