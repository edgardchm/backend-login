const cors = require('cors');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db'); // Asegúrate que ./db exporta el pool correctamente
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

const SECRET_KEY = process.env.JWT_SECRET || 'clave_por_defecto';

// Middleware para verificar el token JWT
function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });

    req.user = user;
    next();
  });
}

// =================== LOGIN ===================
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query(
      'SELECT * FROM usuarios WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const user = result.rows[0];

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    // Crear JWT
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        rol: user.rol,
        nombre: user.nombre
      },
      SECRET_KEY,
      { expiresIn: '8h' }
    );

    // Devolver token y datos del usuario
    res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol
      }
    });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =================== TIPO DE REPUESTOS ===================
app.get('/repuestos', verificarToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tipos_repuestos ORDER BY nombre');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los tipos de repuestos' });
  }
});

app.post('/repuestos', verificarToken, async (req, res) => {
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

app.delete('/repuestos/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM tipos_repuestos WHERE id = $1', [id]);
    res.json({ message: 'Repuesto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el repuesto' });
  }
});

// =================== MARCAS ===================
app.get('/marcas', verificarToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM marcas ORDER BY marca');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las marcas' });
  }
});

app.post('/marcas', verificarToken, async (req, res) => {
  const { marca } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO marcas (marca) VALUES ($1) RETURNING *',
      [marca]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agregar la marca' });
  }
});

app.put('/marcas/:id', verificarToken, async (req, res) => {
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

app.delete('/marcas/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM marcas WHERE id = $1', [id]);
    res.json({ message: 'Marca eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la marca' });
  }
});

// =================== REPUESTOS ===================
const generarSKU = (nombreTipo, nombreMarca) => {
  const tipo = nombreTipo.slice(0, 3).toUpperCase();
  const marca = nombreMarca.slice(0, 3).toUpperCase();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${tipo}-${marca}-${random}`;
};

app.get('/repuestos-marca', verificarToken, async (req, res) => {
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

app.post('/repuestos-marca', verificarToken, async (req, res) => {
  const { nombre, descripcion, precio, precio_mayor, precio_cliente, tipo_repuesto_id, marca_id, stock } = req.body;

  try {
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

app.delete('/repuestos-marca/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM repuestos WHERE id = $1', [id]);
    res.json({ message: 'Repuesto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el repuesto' });
  }
});

app.get('/repuestos/:tipoRepuestoId/:marcaId', verificarToken, async (req, res) => {
  const { tipoRepuestoId, marcaId } = req.params;
  try {
    const result = await db.query(`
      SELECT id, nombre, precio_mayor, precio_cliente, stock, sku
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

// =================== MARCAS POR TIPO ===================
app.get('/marcas-por-tipo/:tipoRepuestoId', verificarToken, async (req, res) => {
  const { tipoRepuestoId } = req.params;
  try {
    const result = await db.query(`
      SELECT m.id, m.marca, t.nombre AS tipo_repuesto
      FROM marcas m
      JOIN marca_tipo_repuesto mt ON m.id = mt.marca_id
      JOIN tipos_repuestos t ON mt.tipo_repuesto_id = t.id
      WHERE t.id = $1
    `, [tipoRepuestoId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las marcas' });
  }
});

// =================== PRODUCTOS ===================
app.get('/productos/:sku', verificarToken, async (req, res) => {
  const { sku } = req.params;

  try {
    const query = `
    SELECT p.*, 
         m.marca AS marca, 
         t.nombre AS tipo
    FROM productos p
    LEFT JOIN marcas m ON p.marca_id = m.id
    LEFT JOIN tipos_producto t ON p.tipo_id = t.id
    WHERE p.sku = $1
`;

    const result = await db.query(query, [sku]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error consultando producto por SKU:', error);
    res.status(500).json({ error: error.message, stack: error.stack });  // <- Aquí el mensaje real
  }
});

// =================== SERVER ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
