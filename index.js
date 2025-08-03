const cors = require('cors');
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({
    origin: ['http://localhost:8100']
  }));

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
    const result = await db.query(
      'INSERT INTO tipos_repuestos (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agregar el repuesto (puede que ya exista)' });
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

// Crear nuevo repuesto
app.post('/repuestos-marca', async (req, res) => {
  const { nombre, tipo_repuesto_id, marca_id, precio_mayor, precio_cliente } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO repuestos 
        (nombre, tipo_repuesto_id, marca_id, precio_mayor, precio_cliente)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre, tipo_repuesto_id, marca_id, precio_mayor, precio_cliente]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
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
app.get('/marcas-por-tipo/:tipoId', async (req, res) => {
  const { tipoId } = req.params;
  try {
    const result = await db.query(
      `SELECT DISTINCT m.id, m.marca
       FROM marcas m
       JOIN repuestos_marca r ON r.marca_id = m.id
       WHERE r.tipo_repuesto_id = $1
       ORDER BY m.marca`,
      [tipoId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener marcas por tipo de repuesto' });
  }
});


  

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
