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
  

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
