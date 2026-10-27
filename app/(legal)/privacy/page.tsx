import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacidad · Focus",
  description: "Cómo utiliza Focus los datos de tu cuenta, tus archivos y tus instrucciones.",
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacidad de Focus</h1>
      <p className="text-sm text-muted-foreground">Última actualización: 27 de octubre de 2026.</p>
      <p>Focus permite editar clips y crear animaciones a partir de imágenes e instrucciones. Para consultar cómo se tratan tus datos, escribe a <a href="mailto:elustondo129@gmail.com">elustondo129@gmail.com</a>, el contacto del responsable de este servicio.</p>

      <h2>Datos que utilizamos</h2>
      <ul>
        <li><strong>Cuenta de Facebook:</strong> al iniciar sesión recibimos tu identificador de Facebook, nombre, foto de perfil y correo electrónico, si Facebook lo facilita. Los utilizamos para identificar tu cuenta y asociar tus proyectos. No solicitamos acceso a tus publicaciones, lista de amigos ni biblioteca de fotos o videos de Facebook.</li>
        <li><strong>Contenido que proporcionas:</strong> imágenes, clips, instrucciones, proyectos y resultados generados para realizar las funciones que solicitas.</li>
        <li><strong>Datos técnicos:</strong> identificadores de sesión y de visitante, estado de los trabajos y datos de uso necesarios para aplicar límites, mantener el servicio y resolver errores.</li>
      </ul>

      <h2>Procesamiento y proveedores</h2>
      <p>Focus utiliza Railway para alojar el servicio y almacenar sus archivos. Cuando solicitas una función de inteligencia artificial, las instrucciones y las imágenes o fragmentos necesarios se envían a Meta Model API para su análisis, generación o segmentación. Esos proveedores procesan la información según sus propias condiciones y políticas.</p>
      <p>Los datos de tu cuenta de Facebook no se incluyen automáticamente en las solicitudes a los modelos de IA. Evita incluir información sensible en los archivos o instrucciones que envías para procesar.</p>

      <h2>Conservación</h2>
      <p>Los medios temporales que no pertenecen a un proyecto guardado pueden eliminarse mediante la limpieza automática a partir de las 24 horas. Los datos de cuenta y los proyectos guardados se conservan para que puedas volver a acceder a ellos, o hasta que solicites su eliminación. Guarda una copia de los archivos que quieras conservar.</p>

      <h2>Cookies y almacenamiento del navegador</h2>
      <p>Utilizamos cookies para mantener tu sesión, verificar el retorno de Facebook y contar las ediciones gratuitas. La sesión puede durar hasta 30 días y el identificador de visitante hasta un año. El navegador también puede conservar instrucciones y estado del editor localmente. Puedes cerrar sesión y borrar los datos del sitio desde tu navegador; estas acciones no eliminan por sí solas la cuenta ni los archivos guardados en el servidor.</p>

      <h2>Consultar, corregir o eliminar tus datos</h2>
      <p>Puedes solicitar información, correcciones o la eliminación de tus datos escribiendo a <a href="mailto:elustondo129@gmail.com">elustondo129@gmail.com</a>. Podemos pedirte información que permita verificar que la cuenta te pertenece, pero nunca tu contraseña de Facebook. Consulta las <Link href="/data-deletion">instrucciones de eliminación de datos</Link>.</p>
    </>
  );
}
