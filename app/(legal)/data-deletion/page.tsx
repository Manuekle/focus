import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Eliminar mis datos · Focus",
  description: "Cómo solicitar la eliminación de tu cuenta de Focus y los datos asociados.",
};

export default function DataDeletionPage() {
  return (
    <>
      <h1>Eliminar mis datos de Focus</h1>
      <p>Puedes solicitar la eliminación de tu cuenta de Focus, los datos de Facebook asociados y tus proyectos y medios guardados.</p>
      <ol>
        <li>Escribe a <a href="mailto:elustondo129@gmail.com?subject=Eliminar%20mis%20datos%20de%20Focus">elustondo129@gmail.com</a> con el asunto <strong>Eliminar mis datos de Focus</strong>.</li>
        <li>Indica el nombre que aparece en tu cuenta de Focus y el correo vinculado, si lo tiene. Si deseas eliminar solo un proyecto o archivo, indica cuál. No envíes contraseñas, códigos de acceso ni documentos de identidad.</li>
        <li>La solicitud se atiende manualmente tras verificar que eres el titular de la cuenta. La eliminación abarca los datos de cuenta y los proyectos y medios asociados que correspondan a tu solicitud.</li>
      </ol>
      <h2>Desconectar Facebook</h2>
      <p>También puedes quitar Focus desde la sección <strong>Apps y sitios web</strong> de la configuración de Facebook. Esto revoca la autorización en Facebook, pero no elimina automáticamente los datos que Focus ya tiene guardados. Para eliminarlos, utiliza el correo de contacto anterior.</p>
      <p>Después de eliminar tu cuenta, iniciar sesión de nuevo puede crear una cuenta nueva. Cerrar sesión o borrar las cookies del navegador tampoco equivale a solicitar la eliminación.</p>
      <p>Más información en la <Link href="/privacy">política de privacidad de Focus</Link>.</p>
    </>
  );
}
