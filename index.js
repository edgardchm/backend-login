const express = require('express');
const bcrypt = require('bcrypt');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(express.json());

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

    res.json({ id: user.id, email: user.email, rol: user.rol });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
