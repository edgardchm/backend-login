const fetch = require('node-fetch');

// Configuración
const BASE_URL = 'http://localhost:3000';
let AUTH_TOKEN = '';

// Función para hacer login
async function login(email, password) {
  try {
    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    
    if (response.ok) {
      AUTH_TOKEN = data.token;
      console.log('✅ Login exitoso');
      console.log('Usuario:', data.user.nombre);
      console.log('Rol:', data.user.rol);
      return true;
    } else {
      console.error('❌ Error en login:', data.error);
      return false;
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
    return false;
  }
}

// Función para probar obtener todos los productos
async function probarObtenerProductos() {
  console.log('\n🔍 Probando obtener todos los productos...');
  
  try {
    const response = await fetch(`${BASE_URL}/productos?pagina=1&limite=5`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Productos obtenidos correctamente');
      console.log(`📊 Total de productos: ${data.estadisticas.total_productos}`);
      console.log(`💰 Stock total: ${data.estadisticas.stock_total}`);
      console.log(`📈 Precio promedio: $${data.estadisticas.precio_promedio}`);
      console.log(`🏷️ Total de marcas: ${data.estadisticas.total_marcas}`);
      console.log(`📦 Total de tipos: ${data.estadisticas.total_tipos}`);
      console.log(`⚠️ Productos con stock bajo: ${data.estadisticas.productos_stock_bajo}`);
      console.log(`📄 Página ${data.paginacion.pagina} de ${data.paginacion.totalPaginas}`);
      
      if (data.productos.length > 0) {
        console.log('\n📋 Primeros productos:');
        data.productos.forEach((producto, index) => {
          console.log(`  ${index + 1}. ${producto.nombre} - SKU: ${producto.sku} - Stock: ${producto.stock} - $${producto.precio}`);
        });
      }
    } else {
      console.error('❌ Error obteniendo productos:', data.error);
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
  }
}

// Función para probar crear un producto
async function probarCrearProducto() {
  console.log('\n➕ Probando crear un producto...');
  
  try {
    const nuevoProducto = {
      nombre: 'Producto de Prueba',
      descripcion: 'Este es un producto de prueba para testing',
      sku: 'TEST-001',
      precio: 29.99,
      precio_mayor: 25.00,
      precio_cliente: 35.00,
      stock: 100
    };

    const response = await fetch(`${BASE_URL}/productos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(nuevoProducto)
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Producto creado exitosamente');
      console.log(`🆔 ID: ${data.producto.id}`);
      console.log(`📝 Nombre: ${data.producto.nombre}`);
      console.log(`🏷️ SKU: ${data.producto.sku}`);
      console.log(`💰 Precio: $${data.producto.precio}`);
      console.log(`📦 Stock: ${data.producto.stock}`);
      return data.producto.id; // Retornar ID para pruebas posteriores
    } else {
      console.error('❌ Error creando producto:', data.error);
      return null;
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
    return null;
  }
}

// Función para probar obtener un producto específico
async function probarObtenerProducto(id) {
  if (!id) return;
  
  console.log('\n🔍 Probando obtener producto específico...');
  
  try {
    const response = await fetch(`${BASE_URL}/productos/${id}`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Producto obtenido correctamente');
      console.log(`📝 Nombre: ${data.nombre}`);
      console.log(`🏷️ SKU: ${data.sku}`);
      console.log(`💰 Precio: $${data.precio}`);
      console.log(`📦 Stock: ${data.stock}`);
      console.log(`📅 Creado: ${data.fecha_creacion}`);
    } else {
      console.error('❌ Error obteniendo producto:', data.error);
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
  }
}

// Función para probar actualizar un producto
async function probarActualizarProducto(id) {
  if (!id) return;
  
  console.log('\n✏️ Probando actualizar producto...');
  
  try {
    const actualizacion = {
      nombre: 'Producto de Prueba Actualizado',
      precio: 39.99,
      stock: 150
    };

    const response = await fetch(`${BASE_URL}/productos/${id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(actualizacion)
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Producto actualizado exitosamente');
      console.log(`📝 Nuevo nombre: ${data.producto.nombre}`);
      console.log(`💰 Nuevo precio: $${data.producto.precio}`);
      console.log(`📦 Nuevo stock: ${data.producto.stock}`);
      console.log(`📅 Actualizado: ${data.producto.fecha_actualizacion}`);
    } else {
      console.error('❌ Error actualizando producto:', data.error);
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
  }
}

// Función para probar actualizar stock
async function probarActualizarStock(id) {
  if (!id) return;
  
  console.log('\n📦 Probando actualizar stock...');
  
  try {
    const actualizacionStock = {
      operacion: 'add',
      cantidad: 50,
      motivo: 'Reabastecimiento de inventario'
    };

    const response = await fetch(`${BASE_URL}/productos/${id}/stock`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(actualizacionStock)
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Stock actualizado exitosamente');
      console.log(`📦 Stock anterior: ${data.operacion_realizada.stock_anterior}`);
      console.log(`📦 Stock nuevo: ${data.operacion_realizada.stock_nuevo}`);
      console.log(`📊 Diferencia: ${data.operacion_realizada.diferencia}`);
      console.log(`📝 Motivo: ${data.operacion_realizada.motivo}`);
    } else {
      console.error('❌ Error actualizando stock:', data.error);
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
  }
}

// Función para probar búsqueda de productos
async function probarBuscarProductos() {
  console.log('\n🔍 Probando búsqueda de productos...');
  
  try {
    const response = await fetch(`${BASE_URL}/productos/buscar/Producto`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Búsqueda realizada correctamente');
      console.log(`🔍 Término de búsqueda: ${data.busqueda}`);
      console.log(`📊 Total de resultados: ${data.total || 1}`);
      
      if (data.productos) {
        console.log('\n📋 Productos encontrados:');
        data.productos.forEach((producto, index) => {
          console.log(`  ${index + 1}. ${producto.nombre} - SKU: ${producto.sku}`);
        });
      } else {
        console.log('📋 Producto encontrado:', data.nombre);
      }
    } else {
      console.error('❌ Error en búsqueda:', data.error);
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
  }
}

// Función para probar filtros específicos
async function probarFiltros() {
  console.log('\n🔍 Probando filtros específicos...');
  
  try {
    // Probar filtro por stock bajo
    const response = await fetch(`${BASE_URL}/productos?stock_minimo=20&limite=3`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Filtros aplicados correctamente');
      console.log(`📊 Productos con stock bajo encontrados: ${data.productos.length}`);
      console.log(`💰 Total de ingresos potenciales: $${data.estadisticas.stock_total * data.estadisticas.precio_promedio}`);
    } else {
      console.error('❌ Error con filtros:', data.error);
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
  }
}

// Función para probar eliminar un producto
async function probarEliminarProducto(id) {
  if (!id) return;
  
  console.log('\n🗑️ Probando eliminar producto...');
  
  try {
    const response = await fetch(`${BASE_URL}/productos/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Producto eliminado exitosamente');
      console.log(`🗑️ Producto eliminado: ${data.producto_eliminado.nombre}`);
      console.log(`🏷️ SKU: ${data.producto_eliminado.sku}`);
    } else {
      console.error('❌ Error eliminando producto:', data.error);
      if (data.ventas_asociadas) {
        console.log(`⚠️ No se puede eliminar porque tiene ${data.ventas_asociadas} ventas asociadas`);
      }
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
  }
}

// Función principal para ejecutar todas las pruebas
async function ejecutarPruebas() {
  console.log('🚀 Iniciando pruebas de endpoints de productos...\n');
  
  // Credenciales de prueba (ajusta según tu base de datos)
  const email = 'admin@ejemplo.com';  // Cambia por un email válido
  const password = 'password123';     // Cambia por una contraseña válida
  
  // 1. Login
  const loginExitoso = await login(email, password);
  
  if (!loginExitoso) {
    console.log('❌ No se pudo hacer login. Verifica las credenciales y que el servidor esté corriendo.');
    return;
  }
  
  // 2. Probar obtener productos
  await probarObtenerProductos();
  
  // 3. Probar crear producto
  const productoId = await probarCrearProducto();
  
  // 4. Probar obtener producto específico
  await probarObtenerProducto(productoId);
  
  // 5. Probar actualizar producto
  await probarActualizarProducto(productoId);
  
  // 6. Probar actualizar stock
  await probarActualizarStock(productoId);
  
  // 7. Probar búsqueda
  await probarBuscarProductos();
  
  // 8. Probar filtros
  await probarFiltros();
  
  // 9. Probar eliminar producto (solo si no tiene ventas asociadas)
  await probarEliminarProducto(productoId);
  
  console.log('\n✨ Pruebas completadas!');
}

// Ejecutar las pruebas si el archivo se ejecuta directamente
if (require.main === module) {
  ejecutarPruebas().catch(console.error);
}

module.exports = {
  login,
  probarObtenerProductos,
  probarCrearProducto,
  probarObtenerProducto,
  probarActualizarProducto,
  probarActualizarStock,
  probarBuscarProductos,
  probarFiltros,
  probarEliminarProducto
};
