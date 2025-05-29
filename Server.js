const express = require('express');
const app = express();
const path = require('path');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fs = require('fs');
const multer = require('multer');
const JSZip = require('jszip');
const xlsx = require('xlsx');
const jsonParser = express.json();
const urlencodedParser = express.urlencoded({ extended: true });
const mime = require('mime-types');

require('dotenv').config(); // Agrega al inicio
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: '-08:00'
});

const uploadDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir,{ recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

app.use(express.json()); // Para parsear JSON
app.use(express.urlencoded({ extended: true }));

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // 1. SOLUCIÓN NUCLEAR: Verificar nombre del campo
    if (file.fieldname !== 'archivo') {
      return cb(new Error('Campo inesperado detectado'), false);
    }
    
    // 2. Validación de tipos MIME
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/pdf'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);  // ✅ Archivo permitido
    } else {
      cb(new Error('Solo se permiten archivos Excel o PDF'), false);  // ❌ Tipo inválido
    }
  },
  limits: { 
    fileSize: 10 * 1024 * 1024,  // 10MB
    fields: 0,  // No permite campos adicionales
    files: 1    // Solo permite 1 archivo
  }
});


app.use(session({
  secret: 'claveSecreta123',
  resave: false,
  saveUninitialized: false
}));


app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('uploads'));

db.connect((err) => {
  if (err) {
    console.error('❌ Error al conectar con MySQL:', err);
    process.exit(1);
  }
  console.log('✅ Conexión a MySQL establecida');
});

// Middleware: requiere sesión iniciada
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// Middleware: verificar tipo de usuario (para futuro)
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.session.user && roles.includes(req.session.user.tipo_usuario)) {
      next();
    } else {
      res.status(403).send('<h1>403 - Acceso Denegado</h1>');
    }
  };
}

app.get('/equipos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'equipos.html'));
}); 

app.get('/subir-archivo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'subir-archivo.html'));
});

app.get('/archivos-subidos', (req, res) => {
  db.query('SELECT * FROM archivos_subidos', (error, results) => {
    if (error) return res.status(500).json({ error: 'Error en base de datos' });
    res.json(results);
  });
});

// Ruta para mostrar la página de descarga (HTML)
app.get('/descargar-archivos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'descargar-archivos.html'));
});


// 🔹 Ruta para obtener el tipo de usuario (usada por navbar)
app.get('/tipo-usuario', requireLogin, (req, res) => {
  res.json({ tipo_usuario: req.session.user.tipo_usuario });
});

// 🔹 Página principal protegida (requiere login)
app.get('/', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🔹 Página de login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 🔹 Página de registro
app.get('/registrar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'registrar.html'));
});

// 🔹 Cerrar sesión
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// 🔹 Procesar inicio de sesión
app.post('/login', (req, res) => {
  const { nombre_usuario, password } = req.body;

  db.query('SELECT * FROM usuarios WHERE nombre_usuario = ?', [nombre_usuario], async (err, results) => {
    if (err || results.length === 0) {
      return res.send('Usuario no encontrado');
    }

    const usuario = results[0];
    const match = await bcrypt.compare(password, usuario.password_hash);
    if (!match) return res.send('Contraseña incorrecta');

    console.log('Usuario autenticado:', usuario);

    req.session.user = {
      id: usuario.id,
      nombre_usuario: usuario.nombre_usuario,
      tipo_usuario: usuario.tipo_usuario
    };

    res.redirect('/');
  });
});

// 🔹 Procesar registro de usuario nuevo
app.post('/registrar', async (req, res) => {
  const { nombre_usuario, password, codigo_acceso } = req.body;

  db.query('SELECT tipo_usuario FROM codigos_acceso WHERE codigo = ?', [codigo_acceso], async (err, results) => {
    if (err || results.length === 0) {
      return res.send('Código de acceso inválido');
    }

    const tipo_usuario = results[0].tipo_usuario;
    const hash = await bcrypt.hash(password, 10);

    db.query(
      'INSERT INTO usuarios (nombre_usuario, password_hash, tipo_usuario) VALUES (?, ?, ?)',
      [nombre_usuario, hash, tipo_usuario],
      (err) => {
        if (err) return res.send('Error al registrar usuario');
        res.redirect('/login');
      }
    );
  });
});

app.get('/navbar', requireLogin, (req, res) => {
  const tipo = req.session.user.tipo_usuario;

  let menu = `
    <nav>
      <ul>
        <li><a href="/">Inicio</a></li>
  `;

  if (tipo === 'medico') {
    menu += `
      <li><a href="/ver-pacientes">Ver Pacientes</a></li>
      <li><a href="/ver-medicamentos">Ver Medicamentos</a></li>
      <li><a href="/ver-maquinas">Ver Máquinas</a></li>
      <li><a href="/agregar-paciente">Agregar Paciente</a></li>
      <li><a href="/agregar-medicamento">Agregar Medicamento</a></li>
      <li><a href="/agregar-maquina">Agregar Máquina</a></li>
      <li><a href="/subir-archivo">Subir Archivos</a></li>
      <li><a href="/descargar-archivos">Descargar archivos</a></li>
    `;
  } else if (tipo === 'enfermero') {
    menu += `
      <li><a href="/ver-pacientes">Ver Pacientes</a></li>
      <li><a href="/ver-medicamentos">Ver Medicamentos</a></li>
      <li><a href="/ver-maquinas">Ver Máquinas</a></li>
      <li><a href="/agregar-paciente">Agregar Paciente</a></li>
      <li><a href="/eliminar-medicamento">Eliminar Medicamento</a></li>
      <li><a href="/eliminar-maquina">Eliminar Máquina</a></li>
    `;
  } else if (tipo === 'paciente') {
    menu += `
      <li><a href="/ver-pacientes">Ver Otros Pacientes</a></li>
      
    `;
  }

  menu += `
      <li><a href="/logout">Cerrar Sesión</a></li>
      </ul>
    </nav>
  `;

  res.send(menu);
});

// ✅ SUBIDA DE ARCHIVOS CORREGIDA
app.post('/upload', upload.single('archivo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Guardar metadatos
    db.query(
      'INSERT INTO archivos_subidos (nombre, tipo, ruta) VALUES (?, ?, ?)',
      [req.file.originalname, req.file.mimetype, req.file.path],
      (error, results) => {
        if (error) {
          console.error("Error al guardar en BD:", error);
          return res.status(500).json({ error: 'Error en base de datos' });
        }
        
        // Procesar Excel si es necesario
        const esExcel = [
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ].includes(req.file.mimetype);
        
        if (esExcel) {
          try {
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
            console.log("Datos Excel procesados:", data.length, "registros");
            // Aquí tu lógica para procesar datos
          } catch (excelError) {
            console.error("Error procesando Excel:", excelError);
          }
        }

        res.json({ 
          success: true, 
          message: 'Archivo subido y registrado correctamente',
          archivo: req.file.originalname 
        });
      }
    );
  } catch (error) {
    res.status(500).json({
      error: 'Error al subir archivo',
      details: error.message
    });
  }
});

// ✅ GENERACIÓN DE ZIP CORREGIDA
app.get('/generar-zip', async (req, res) => {
  try {
    db.query('SELECT * FROM archivos_subidos', (error, archivos) => {
      if (error) throw error;
      
      if (archivos.length === 0) {
        return res.status(404).json({ error: 'No hay archivos disponibles' });
      }

      const zip = new JSZip();
      let archivosAgregados = 0;
      
      archivos.forEach(archivo => {
        if (fs.existsSync(archivo.ruta)) {
          zip.file(archivo.nombre, fs.readFileSync(archivo.ruta));
          archivosAgregados++;
        }
      });

      if (archivosAgregados === 0) {
        return res.status(404).json({ error: 'No se encontraron archivos válidos' });
      }

      zip.generateAsync({ type: 'nodebuffer' }).then(zipData => {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=archivos.zip');
        res.send(zipData);
      });
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error al generar archivo ZIP',
      details: error.message
    });
  }
});

app.get('/ver-pacientes', requireLogin, (req, res) => {
  db.query('SELECT * FROM pacientes', (err, results) => {
    if (err) return res.send('Error al obtener pacientes.');

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Pacientes</title>
      </head>
      <body>
        <h1>Pacientes Registrados</h1>
        <input type="text" id="buscar" placeholder="Buscar paciente..." style="margin: 20px; padding: 8px;">
        <table>
          <tr><th>Nombre</th><th>Causa</th><th>Fecha de Registro</th></tr>
    `;

    results.forEach(p => {
      html += `<tr><td>${p.nombre}</td><td>${p.causa}</td><td>${new Date(p.fecha_registro).toLocaleString()}</td></tr>`;
    });

    html += `
        </table>
        <a href="/">Volver al inicio</a>
           <script>
                    document.getElementById('buscar').addEventListener('keyup', (e) => {
                        const query = e.target.value.toLowerCase();
                        const filas = document.querySelectorAll('table tr');
                        
                        filas.forEach((fila, index) => {
                            if (index === 0) return; // Ignorar encabezados
                            const texto = fila.innerText.toLowerCase();
                            fila.style.display = texto.includes(query) ? '' : 'none';
                        });
                    });
                </script>
      </body>
      </html>
    `;
    res.send(html);

    

  });
});

app.get('/agregar-paciente', requireLogin, requireRole('medico', 'enfermero'), (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Agregar Paciente</title>
    </head>
    <body>
      <h2>Agregar Paciente</h2>
      <form action="/agregar-paciente" method="POST">
        <label>Nombre:</label><input name="nombre" required>
        <label>Causa:</label><input name="causa" required>
        <button type="submit">Guardar</button>
      </form>
      <a href="/">Volver</a>
    </body>
    </html>
  `);
});
app.post('/agregar-paciente', requireLogin, requireRole('medico', 'enfermero'), (req, res) => {
  const { nombre, causa } = req.body;
  db.query('INSERT INTO pacientes (nombre, causa, fecha_registro) VALUES (?, ?, NOW())',
    [nombre, causa], (err) => {
      if (err) return res.send('Error al guardar paciente.');
      res.redirect('/ver-pacientes');
    });
});

app.get('/ver-medicamentos', requireLogin, (req, res) => {
  db.query('SELECT * FROM medicamentos', (err, results) => {
    if (err) return res.send('Error al obtener medicamentos.');

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Medicamentos</title>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <h1>Medicamentos Registrados</h1>
        <table>
          <tr><th>Nombre</th><th>Función</th></tr>
    `;

    results.forEach(m => {
      html += `<tr><td>${m.nombre}</td><td>${m.funcion}</td></tr>`;
    });

    html += `
        </table>
        <a href="/">Volver al inicio</a>
      </body>
      </html>
    `;
    res.send(html);
  });
});

app.get('/agregar-medicamento', requireLogin, requireRole('medico'), (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Agregar Medicamento</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h2>Agregar Medicamento</h2>
      <form action="/agregar-medicamento" method="POST">
        <label>Nombre:</label><input name="nombre" required>
        <label>Función:</label><input name="funcion" required>
        <button type="submit">Guardar</button>
      </form>
      <a href="/">Volver</a>
    </body>
    </html>
  `);
});

app.post('/agregar-medicamento', requireLogin, requireRole('medico'), (req, res) => {
  const { nombre, funcion } = req.body;
  db.query('INSERT INTO medicamentos (nombre, funcion) VALUES (?, ?)', [nombre, funcion], (err) => {
    if (err) return res.send('Error al guardar medicamento.');
    res.redirect('/ver-medicamentos');
  });
});


app.get('/ver-maquinas', requireLogin, (req, res) => {
  db.query('SELECT * FROM maquinas', (err, results) => {
    if (err) return res.send('Error al obtener máquinas.');

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Máquinas</title>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <h1>Máquinas Registradas</h1>
        <table>
          <tr><th>Nombre</th><th>Tipo</th><th>Estado</th></tr>
    `;

    results.forEach(m => {
      html += `<tr><td>${m.nombre}</td><td>${m.tipo}</td><td>${m.estado}</td></tr>`;
    });

    html += `
        </table>
        <a href="/">Volver al inicio</a>
      </body>
      </html>
    `;
    res.send(html);
  });
});

app.get('/agregar-maquina', requireLogin, requireRole('medico'), (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Agregar Máquina</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h2>Agregar Máquina</h2>
      <form action="/agregar-maquina" method="POST">
        <label>Nombre:</label><input name="nombre" required>
        <label>Tipo:</label><input name="tipo" required>
        <label>Estado:</label><input name="estado" required>
        <button type="submit">Guardar</button>
      </form>
      <a href="/">Volver</a>
    </body>
    </html>
  `);
});

app.post('/agregar-maquina', requireLogin, requireRole('medico'), (req, res) => {
  const { nombre, tipo, estado } = req.body;
  db.query('INSERT INTO maquinas (nombre, tipo, estado) VALUES (?, ?, ?)', [nombre, tipo, estado], (err) => {
    if (err) return res.send('Error al guardar máquina.');
    res.redirect('/ver-maquinas');
  });
});
app.post('/agregar-maquina', requireLogin, requireRole('medico'), (req, res) => {
  const { nombre, tipo, estado } = req.body;
  db.query('INSERT INTO maquinas (nombre, tipo, estado) VALUES (?, ?, ?)', [nombre, tipo, estado], (err) => {
    if (err) return res.send('Error al guardar máquina.');
    res.redirect('/ver-maquinas');
  });
});

// Mostrar medicamentos con opción a eliminar (solo enfermero)
app.get('/eliminar-medicamento', requireLogin, requireRole('enfermero'), (req, res) => {
  db.query('SELECT * FROM medicamentos', (err, results) => {
    if (err) return res.send('Error al obtener medicamentos.');

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Eliminar Medicamento</title>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <h1>Eliminar Medicamento</h1>
        <table>
          <tr><th>Nombre</th><th>Función</th><th>Acción</th></tr>
    `;

    results.forEach(m => {
      html += `
        <tr>
          <td>${m.nombre}</td>
          <td>${m.funcion}</td>
          <td>
            <form action="/eliminar-medicamento" method="POST" style="display:inline;">
              <input type="hidden" name="id" value="${m.id}">
              <button type="submit" onclick="return confirm('¿Estás seguro de eliminar este medicamento?');">Eliminar</button>
            </form>
          </td>
        </tr>
      `;
    });

    html += `
        </table>
        <a href="/">Volver al inicio</a>
      </body>
      </html>
    `;
    res.send(html);
  });
});

// Procesar eliminación de medicamento (solo enfermero)
app.post('/eliminar-medicamento', requireLogin, requireRole('enfermero'), (req, res) => {
  const { id } = req.body;
 db.beginTransaction(err => {
    if (err) return res.send('Error al iniciar transacción');

    // 1. Eliminar relaciones en tablas vinculadas (ej: pacientes_medicamentos)
    db.query('DELETE FROM pacientes_medicamentos WHERE medicamento_id = ?', [id], (err) => {
      if (err) return db.rollback(() => res.send('Error al eliminar relaciones'));

      // 2. Eliminar el medicamento
      db.query('DELETE FROM medicamentos WHERE id = ?', [id], (err) => {
        if (err) return db.rollback(() => res.send('Error al eliminar medicamento'));

        // Confirmar transacción
        db.commit((err) => {
          if (err) return db.rollback(() => res.send('Error al confirmar cambios'));
          res.redirect('/eliminar-medicamento');
        });
      });
    });
  });
});

// Mostrar máquinas con opción a eliminar (solo enfermero)
app.get('/eliminar-maquina', requireLogin, requireRole('enfermero'), (req, res) => {
  db.query('SELECT * FROM maquinas', (err, results) => {
    if (err) return res.send('Error al obtener máquinas.');

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Eliminar Máquina</title>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <h1>Eliminar Máquina</h1>
        <table>
          <tr><th>Nombre</th><th>Tipo</th><th>Estado</th><th>Acción</th></tr>
    `;

    results.forEach(m => {
      html += `
        <tr>
          <td>${m.nombre}</td>
          <td>${m.tipo}</td>
          <td>${m.estado}</td>
          <td>
            <form action="/eliminar-maquina" method="POST" style="display:inline;">
              <input type="hidden" name="id" value="${m.id}">
              <button type="submit" onclick="return confirm('¿Estás seguro de eliminar esta máquina?');">Eliminar</button>
            </form>
          </td>
        </tr>
      `;
    });

    html += `
        </table>
        <a href="/">Volver al inicio</a>
      </body>
      </html>
    `;
    res.send(html);
  });
});

// Procesar eliminación de máquina (solo enfermero)
app.post('/eliminar-maquina', requireLogin, requireRole('enfermero'), (req, res) => {
  const { id } = req.body;
  db.query('DELETE FROM maquinas WHERE id = ?', [id], (err) => {
    if (err) return res.send('Error al eliminar máquina.');
    res.redirect('/eliminar-maquina');
  });
});

// 🔹 Iniciar el servidor
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
