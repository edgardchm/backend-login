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

// Función para probar el historial de ventas
async function probarHistorialVentas() {
  console.log('\n🔍 Probando historial de ventas...');
  
  try {
    const response = await fetch(`${BASE_URL}/ventas/historial?pagina=1&limite=5`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Historial obtenido correctamente');
      console.log(`📊 Total de ventas: ${data.estadisticas.total_ventas}`);
      console.log(`💰 Total de ingresos: $${data.estadisticas.total_ingresos}`);
      console.log(`📈 Promedio por venta: $${data.estadisticas.promedio_venta}`);
      console.log(`👥 Total de vendedores: ${data.estadisticas.total_vendedores}`);
      console.log(`📄 Página ${data.paginacion.pagina} de ${data.paginacion.totalPaginas}`);
      
      if (data.ventas.length > 0) {
        console.log('\n📋 Últimas ventas:');
        data.ventas.forEach((venta, index) => {
          console.log(`  ${index + 1}. Boleta #${venta.numero_boleta} - $${venta.total} - ${venta.vendedor}`);
        });
      }
      
      if (data.top_vendedores.length > 0) {
        console.log('\n🏆 Top vendedores:');
        data.top_vendedores.forEach((vendedor, index) => {
          console.log(`  ${index + 1}. ${vendedor.vendedor} - ${vendedor.total_ventas} ventas - $${vendedor.total_ventas_monto}`);
        });
      }
    } else {
      console.error('❌ Error obteniendo historial:', data.error);
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
  }
}

// Función para probar reporte resumido
async function probarReporteResumido() {
  console.log('\n📊 Probando reporte resumido del mes...');
  
  try {
    const response = await fetch(`${BASE_URL}/ventas/reporte-resumen/mes`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Reporte resumido obtenido correctamente');
      console.log(`📅 Período: ${data.periodo}`);
      console.log(`📊 Total de ventas: ${data.estadisticas.total_ventas}`);
      console.log(`💰 Total de ingresos: $${data.estadisticas.total_ingresos}`);
      console.log(`📈 Promedio por venta: $${data.estadisticas.promedio_venta}`);
      
      if (data.ventas_por_dia.length > 0) {
        console.log('\n📅 Ventas por día:');
        data.ventas_por_dia.forEach(dia => {
          console.log(`  ${dia.dia}: ${dia.total_ventas} ventas - $${dia.total_ingresos}`);
        });
      }
      
      if (data.productos_mas_vendidos.length > 0) {
        console.log('\n🛍️ Productos más vendidos:');
        data.productos_mas_vendidos.slice(0, 5).forEach((producto, index) => {
          console.log(`  ${index + 1}. ${producto.descripcion} - ${producto.total_vendido} unidades - $${producto.total_ingresos}`);
        });
      }
    } else {
      console.error('❌ Error obteniendo reporte:', data.error);
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
  }
}

// Función para probar filtros específicos
async function probarFiltros() {
  console.log('\n🔍 Probando filtros específicos...');
  
  try {
    // Probar filtro por vendedor
    const response = await fetch(`${BASE_URL}/ventas/historial?vendedor=Juan&limite=3`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Filtro por vendedor funcionando');
      console.log(`📊 Ventas encontradas: ${data.ventas.length}`);
      console.log(`💰 Total filtrado: $${data.estadisticas.total_ingresos}`);
    } else {
      console.error('❌ Error con filtro:', data.error);
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
  }
}

// Función principal para ejecutar todas las pruebas
async function ejecutarPruebas() {
  console.log('🚀 Iniciando pruebas de endpoints de ventas...\n');
  
  // Credenciales de prueba (ajusta según tu base de datos)
  const email = 'admin@ejemplo.com';  // Cambia por un email válido
  const password = 'password123';     // Cambia por una contraseña válida
  
  // 1. Login
  const loginExitoso = await login(email, password);
  
  if (!loginExitoso) {
    console.log('❌ No se pudo hacer login. Verifica las credenciales y que el servidor esté corriendo.');
    return;
  }
  
  // 2. Probar historial
  await probarHistorialVentas();
  
  // 3. Probar reporte resumido
  await probarReporteResumido();
  
  // 4. Probar filtros
  await probarFiltros();
  
  console.log('\n✨ Pruebas completadas!');
}

// Ejecutar las pruebas si el archivo se ejecuta directamente
if (require.main === module) {
  ejecutarPruebas().catch(console.error);
}

module.exports = {
  login,
  probarHistorialVentas,
  probarReporteResumido,
  probarFiltros
};
