/**
 * The Mermaid coverage gallery.
 *
 * `beautiful-mermaid` — the renderer behind every ```mermaid fence in a chat
 * reply (`components/ai-elements/mermaid-plugin.ts`) — supports six diagram
 * families and throws on the rest, at which point the plugin lazily loads
 * mermaid.js instead. Which of the two draws a given diagram is invisible in
 * the chat, and the difference is ~500KB and a theme that ignores our tokens.
 *
 * So this is the list of every construct the fast renderer is supposed to
 * cover, one sample each. `/dev/mermaid` draws them, and
 * `scripts/check-mermaid-samples.mjs` renders them headlessly and fails on the
 * first one that falls through to the fallback.
 */
export type MermaidSample = {
  readonly n: number;
  readonly title: string;
  readonly code: string;
};

export type MermaidSampleGroup = {
  readonly family: string;
  readonly samples: readonly MermaidSample[];
};

let counter = 0;
const s = (title: string, code: string): MermaidSample => ({
  n: (counter += 1),
  title,
  code: code.trim(),
});

const flowchart: readonly MermaidSample[] = [
  s("Simple Flow", `
graph TD
  A[Inicio] --> B[Procesar]
  B --> C[Fin]
`),
  s("Original Node Shapes", `
graph TD
  A[Rectangle] --> B(Rounded)
  B --> C{Diamond}
  C --> D((Circle))
`),
  s("Batch 1 Shapes", `
graph TD
  A([Stadium]) --> B[[Subroutine]]
  B --> C[(Cylinder)]
  C --> D{{Hexagon}}
`),
  s("Batch 2 Shapes", `
graph TD
  A>Asymmetric] --> B[/Trapezoid\\]
  B --> C[\\Trapezoid Alt/]
  C --> D(((Double Circle)))
`),
  s("All 12 Flowchart Shapes", `
graph TD
  A[Rectangle] --> B(Rounded)
  B --> C([Stadium])
  C --> D[[Subroutine]]
  D --> E[(Cylinder)]
  E --> F((Circle))
  F --> G>Asymmetric]
  G --> H{Diamond}
  H --> I{{Hexagon}}
  I --> J[/Trapezoid\\]
  J --> K[\\Trapezoid Alt/]
  K --> L(((Double Circle)))
`),
  s("All Edge Styles", `
graph LR
  A[Solid] --> B[Target]
  C[Dotted] -.-> D[Target]
  E[Thick] ==> F[Target]
`),
  s("No-Arrow Edges", `
graph LR
  A[Solid] --- B[Link]
  C[Dotted] -.- D[Link]
  E[Thick] === F[Link]
`),
  s("Text-Embedded Labels", `
graph LR
  A[Request] -- valida --> B[Handler]
  B -. reintenta .-> C[Cola]
  C == confirma ==> D[Listo]
`),
  s("Bidirectional Arrows", `
graph LR
  A[Cliente] <--> B[Servidor]
  B <-.-> C[Cache]
  C <==> D[Base de datos]
`),
  s("Parallel Links (&)", `
graph TD
  A[Ingesta] --> B[Cola] & C[Log]
  B & C --> D[Worker]
`),
  s("Chained Edges", `
graph LR
  A[Lead] --> B[Contacto] --> C[Propuesta] --> D[Cierre]
`),
  s("linkStyle: Color-Coded Edges", `
graph LR
  A[Pago] --> B[Aprobado]
  A --> C[Rechazado]
  A --> D[Pendiente]
  linkStyle 0 stroke:#22c55e,stroke-width:2px
  linkStyle 1 stroke:#ef4444,stroke-width:2px
  linkStyle 2 stroke:#f59e0b,stroke-width:2px
`),
  s("linkStyle: Default + Override", `
graph LR
  A[Origen] --> B[Uno]
  A --> C[Dos]
  A --> D[Tres]
  linkStyle default stroke:#64748b,stroke-width:1.5px
  linkStyle 2 stroke:#3b82f6,stroke-width:3px
`),
  s("Direction: Left-Right (LR)", `
graph LR
  A[Formulario] --> B[Validación]
  B --> C[CRM]
  C --> D[Seguimiento]
`),
  s("Direction: Bottom-Top (BT)", `
graph BT
  A[Base de datos] --> B[API]
  B --> C[Interfaz]
  C --> D[Usuario]
`),
  s("Subgraphs", `
graph TD
  subgraph Frontend
    A[Next.js] --> B[Componentes]
  end
  subgraph Backend
    C[Agente] --> D[Postgres]
  end
  B --> C
`),
  s("Nested Subgraphs", `
graph TD
  subgraph Plataforma
    subgraph Web
      A[App] --> B[API]
    end
    subgraph Datos
      C[Postgres] --> D[S3]
    end
    B --> C
  end
`),
  s("Subgraph Direction Override", `
graph TD
  subgraph Cola
    direction LR
    A[Job] --> B[Worker] --> C[Resultado]
  end
  D[Trigger] --> A
`),
  s("::: Class Shorthand", `
graph LR
  A[Normal] --> B[Éxito]:::ok
  B --> C[Error]:::bad
  classDef ok fill:#dcfce7,stroke:#22c55e,color:#14532d
  classDef bad fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
`),
  s("Inline Style Overrides", `
graph LR
  A[Entrada] --> B[Crítico]
  B --> C[Salida]
  style B fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
`),
  s("CI/CD Pipeline", `
graph LR
  A[Push] --> B{Lint}
  B -- ok --> C[Build]
  B -- falla --> Z[Bloquear]
  C --> D[Tests]
  D --> E{Cobertura}
  E -- ok --> F[Deploy preview]
  E -- baja --> Z
  F --> G[Producción]
`),
  s("System Architecture", `
graph TD
  subgraph Cliente
    A[Navegador]
  end
  subgraph Vercel
    B[Next.js] --> C[Agente Eve]
  end
  subgraph Datos
    D[(Postgres)]
    E[(S3)]
  end
  A --> B
  C --> D
  C --> E
`),
  s("Decision Tree", `
graph TD
  A{¿Lead calificado?} -- sí --> B{¿Presupuesto?}
  A -- no --> C[Nutrir]
  B -- sí --> D[Propuesta]
  B -- no --> E[Seguimiento a 90 días]
  D --> F{¿Firma?}
  F -- sí --> G[Ganado]
  F -- no --> H[Perdido]
`),
  s("Git Branching Workflow", `
graph LR
  A[main] --> B[feature/chat]
  B --> C[commit]
  C --> D[PR]
  D --> E{Review}
  E -- aprueba --> F[merge a main]
  E -- cambios --> C
  F --> G[deploy]
`),
];

const state: readonly MermaidSample[] = [
  s("Basic State Diagram", `
stateDiagram-v2
  [*] --> Borrador
  Borrador --> Revisión
  Revisión --> Publicado
  Publicado --> [*]
`),
  s("Composite States", `
stateDiagram-v2
  [*] --> Activo
  state Activo {
    [*] --> Inactivo
    Inactivo --> Trabajando
    Trabajando --> Inactivo
  }
  Activo --> Cerrado
  Cerrado --> [*]
`),
  s("Connection Lifecycle", `
stateDiagram-v2
  [*] --> Desconectado
  Desconectado --> Conectando: connect()
  Conectando --> Conectado: handshake ok
  Conectando --> Error: timeout
  Conectado --> Desconectado: close()
  Error --> Conectando: retry
  Error --> [*]
`),
  s("CJK State Names", `
stateDiagram-v2
  [*] --> 待機中
  待機中 --> 処理中: 開始
  処理中 --> 完了: 成功
  処理中 --> 失敗: エラー
  完了 --> [*]
`),
];

const sequence: readonly MermaidSample[] = [
  s("Basic Messages", `
sequenceDiagram
  Cliente->>Servidor: GET /leads
  Servidor->>Base: SELECT
  Base-->>Servidor: filas
  Servidor-->>Cliente: 200 OK
`),
  s("Participant Aliases", `
sequenceDiagram
  participant C as Cliente web
  participant A as API del agente
  C->>A: pregunta
  A-->>C: respuesta
`),
  s("Actor Stick Figures", `
sequenceDiagram
  actor U as Dueño
  participant B as Bot
  U->>B: ¿ventas de este mes?
  B-->>U: gráfico + resumen
`),
  s("Arrow Types", `
sequenceDiagram
  A->B: línea sin punta
  A->>B: línea con punta
  A-->B: punteada sin punta
  A-->>B: punteada con punta
  A-xB: con cruz
  A--xB: punteada con cruz
`),
  s("Activation Boxes", `
sequenceDiagram
  Cliente->>+Servidor: solicitud
  Servidor->>+Worker: encolar
  Worker-->>-Servidor: hecho
  Servidor-->>-Cliente: respuesta
`),
  s("Self-Messages", `
sequenceDiagram
  participant W as Worker
  W->>W: valida payload
  W->>W: reintenta
  W-->>W: marca como listo
`),
  s("Loop Block", `
sequenceDiagram
  participant P as Poller
  participant Q as Cola
  loop cada 30s
    P->>Q: ¿hay trabajo?
    Q-->>P: 0 o más jobs
  end
`),
  s("Alt/Else Block", `
sequenceDiagram
  Cliente->>API: POST /pago
  alt tarjeta válida
    API-->>Cliente: 201 creado
  else rechazada
    API-->>Cliente: 402 requiere pago
  end
`),
  s("Opt Block", `
sequenceDiagram
  Usuario->>App: guardar perfil
  opt tiene foto nueva
    App->>S3: subir imagen
  end
  App-->>Usuario: guardado
`),
  s("Par Block", `
sequenceDiagram
  Orquestador->>Servicios: iniciar
  par CRM
    Orquestador->>CRM: sincronizar
  and Email
    Orquestador->>Email: enviar
  and Analytics
    Orquestador->>Analytics: registrar
  end
`),
  s("Critical Block", `
sequenceDiagram
  participant S as Servicio
  critical conectar a la base
    S->>DB: connect()
  option timeout
    S->>S: reintentar
  option credenciales inválidas
    S->>Log: alertar
  end
`),
  s("Notes (Right/Left/Over)", `
sequenceDiagram
  participant A as Agente
  participant U as Usuario
  A->>U: hola
  Note right of U: lee el mensaje
  U->>A: consulta
  Note left of A: busca en el CRM
  A-->>U: respuesta
  Note over A,U: sesión persistida
`),
  s("OAuth 2.0 Flow", `
sequenceDiagram
  actor U as Usuario
  participant A as App
  participant I as Proveedor
  U->>A: iniciar sesión
  A->>I: redirect /authorize
  I->>U: pantalla de consentimiento
  U->>I: aprueba
  I-->>A: code
  A->>I: POST /token (code)
  I-->>A: access_token + refresh_token
  A-->>U: sesión iniciada
`),
  s("Database Transaction", `
sequenceDiagram
  participant A as App
  participant D as Postgres
  A->>+D: BEGIN
  A->>D: UPDATE deals
  A->>D: INSERT activity
  alt todo ok
    A->>-D: COMMIT
  else falla
    A->>D: ROLLBACK
  end
`),
  s("Microservice Orchestration", `
sequenceDiagram
  participant G as Gateway
  participant P as Pedidos
  participant S as Stock
  participant F as Facturación
  G->>+P: crear pedido
  P->>+S: reservar
  S-->>-P: reservado
  P->>+F: facturar
  F-->>-P: factura #123
  P-->>-G: pedido confirmado
`),
  s("Self-Messages with Notes", `
sequenceDiagram
  participant R as Reintento
  R->>R: intento 1
  Note right of R: backoff 1s
  R->>R: intento 2
  Note right of R: backoff 2s
  R->>R: intento 3
  Note over R: se rinde
`),
];

const classDiagram: readonly MermaidSample[] = [
  s("Basic Class", `
classDiagram
  class Lead {
    nombre
    email
    crear()
  }
`),
  s("Visibility Markers", `
classDiagram
  class Cuenta {
    +String titular
    -Number saldo
    #String moneda
    ~String region
    +depositar(monto)
    -auditar()
  }
`),
  s("Interface Annotation", `
classDiagram
  class Repositorio {
    <<interface>>
    +buscar(id)
    +guardar(entidad)
  }
`),
  s("Abstract Annotation", `
classDiagram
  class Canal {
    <<abstract>>
    +enviar(mensaje)
  }
`),
  s("Enum Annotation", `
classDiagram
  class EstadoDeal {
    <<enumeration>>
    NUEVO
    CALIFICADO
    PROPUESTA
    GANADO
    PERDIDO
  }
`),
  s("Inheritance (<|--)", `
classDiagram
  Canal <|-- WhatsApp
  Canal <|-- Instagram
  Canal <|-- Email
`),
  s("Composition (*--)", `
classDiagram
  Pedido *-- LineaDePedido
  Pedido *-- Direccion
`),
  s("Aggregation (o--)", `
classDiagram
  Equipo o-- Persona
  Equipo o-- Proyecto
`),
  s("Association (-->)", `
classDiagram
  Cliente --> Pedido
  Pedido --> Factura
`),
  s("Dependency (..>)", `
classDiagram
  Controlador ..> Servicio
  Servicio ..> Cliente HTTP
`),
  s("Realization (..|>)", `
classDiagram
  Repositorio <|.. RepositorioPostgres
  Repositorio <|.. RepositorioMemoria
`),
  s("All 6 Relationship Types", `
classDiagram
  A <|-- B
  C *-- D
  E o-- F
  G --> H
  I ..> J
  K <|.. L
`),
  s("Relationship Labels", `
classDiagram
  Cliente "1" --> "0..*" Pedido : realiza
  Pedido "1" *-- "1..*" Linea : contiene
  Pedido "1" --> "1" Factura : genera
`),
  s("Design Pattern — Observer", `
classDiagram
  class Sujeto {
    <<interface>>
    +suscribir(o)
    +desuscribir(o)
    +notificar()
  }
  class Observador {
    <<interface>>
    +actualizar(evento)
  }
  Sujeto <|.. Pipeline
  Observador <|.. PanelCRM
  Observador <|.. Email
  Pipeline o-- Observador
`),
  s("MVC Architecture", `
classDiagram
  class Modelo {
    +datos
    +validar()
  }
  class Vista {
    +render()
  }
  class Controlador {
    +manejar(evento)
  }
  Controlador --> Modelo
  Controlador --> Vista
  Vista ..> Modelo : lee
`),
  s("Full Hierarchy", `
classDiagram
  class Entidad {
    <<abstract>>
    +String id
    +Date creadoEn
  }
  class Persona {
    +String nombre
    +String email
  }
  class Contacto {
    +String telefono
  }
  class Empleado {
    +String puesto
  }
  Entidad <|-- Persona
  Persona <|-- Contacto
  Persona <|-- Empleado
  Empleado o-- Equipo
  Contacto --> "0..*" Deal : dueño de
`),
];

const er: readonly MermaidSample[] = [
  s("Basic Relationship", `
erDiagram
  CLIENTE ||--o{ PEDIDO : realiza
`),
  s("Entity with Attributes", `
erDiagram
  CLIENTE {
    string nombre
    string email
    date creadoEn
  }
`),
  s("Attribute Keys (PK, FK, UK)", `
erDiagram
  PEDIDO {
    int id PK
    int clienteId FK
    string numero UK
    decimal total
  }
`),
  s("Exactly One to Exactly One (||--||)", `
erDiagram
  USUARIO ||--|| PERFIL : tiene
`),
  s("Exactly One to Zero-or-Many (||--o{)", `
erDiagram
  NEGOCIO ||--o{ AGENTE : opera
`),
  s("Zero-or-One to One-or-More (|o--|{)", `
erDiagram
  CUPON |o--|{ PEDIDO : aplica_a
`),
  s("One-or-More to Zero-or-Many (}|--o{)", `
erDiagram
  AUTOR }|--o{ LIBRO : escribe
`),
  s("All Cardinality Types", `
erDiagram
  A ||--|| B : uno_a_uno
  C ||--o{ D : uno_a_muchos
  E |o--|{ F : cero_uno_a_uno_mas
  G }|--o{ H : uno_mas_a_cero_muchos
  I }o--o| J : cero_muchos_a_cero_uno
`),
  s("Identifying (Solid) Relationship", `
erDiagram
  PEDIDO ||--|{ LINEA_PEDIDO : contiene
`),
  s("Non-Identifying (Dashed) Relationship", `
erDiagram
  EMPLEADO }o..o{ PROYECTO : colabora_en
`),
  s("Mixed Identifying & Non-Identifying", `
erDiagram
  PEDIDO ||--|{ LINEA_PEDIDO : contiene
  PEDIDO }o..o| CUPON : usa
  CLIENTE ||--o{ PEDIDO : realiza
`),
  s("E-Commerce Schema", `
erDiagram
  CLIENTE ||--o{ PEDIDO : realiza
  PEDIDO ||--|{ LINEA_PEDIDO : contiene
  PRODUCTO ||--o{ LINEA_PEDIDO : aparece_en
  PEDIDO ||--o| ENVIO : despacha
  CLIENTE {
    int id PK
    string email UK
    string nombre
  }
  PEDIDO {
    int id PK
    int clienteId FK
    decimal total
    date creadoEn
  }
  PRODUCTO {
    int id PK
    string sku UK
    decimal precio
  }
`),
  s("Blog Platform Schema", `
erDiagram
  AUTOR ||--o{ POST : escribe
  POST ||--o{ COMENTARIO : recibe
  POST }o--o{ ETIQUETA : lleva
  LECTOR ||--o{ COMENTARIO : deja
  POST {
    int id PK
    int autorId FK
    string titulo
    date publicadoEn
  }
  COMENTARIO {
    int id PK
    int postId FK
    string cuerpo
  }
`),
  s("School Management Schema", `
erDiagram
  ESCUELA ||--o{ CURSO : ofrece
  CURSO ||--|{ INSCRIPCION : tiene
  ALUMNO ||--o{ INSCRIPCION : cursa
  PROFESOR ||--o{ CURSO : dicta
  ALUMNO {
    int id PK
    string nombre
    date nacimiento
  }
  CURSO {
    int id PK
    int profesorId FK
    string nombre
    int creditos
  }
  INSCRIPCION {
    int alumnoId FK
    int cursoId FK
    string nota
  }
`),
];

const xychart: readonly MermaidSample[] = [
  s("Simple Bar Chart", `
xychart-beta
  title "Ventas por trimestre"
  x-axis [Q1, Q2, Q3, Q4]
  y-axis "Miles de USD" 0 --> 120
  bar [42, 68, 95, 114]
`),
  s("Line Chart", `
xychart-beta
  title "Visitas al sitio"
  x-axis [Ene, Feb, Mar, Abr, May, Jun]
  y-axis "Sesiones" 0 --> 5000
  line [1200, 1900, 2400, 3100, 3900, 4600]
`),
  s("Bar and Line Overlay", `
xychart-beta
  title "Leads vs. conversión"
  x-axis [Ene, Feb, Mar, Abr, May]
  y-axis "Cantidad" 0 --> 200
  bar [120, 145, 160, 178, 190]
  line [30, 44, 52, 61, 74]
`),
  s("Horizontal Bars", `
xychart-beta horizontal
  title "Deals por etapa"
  x-axis [Nuevo, Calificado, Propuesta, Negociación, Cierre]
  y-axis "Deals" 0 --> 60
  bar [58, 41, 27, 16, 9]
`),
  s("Multiple Bar Series", `
xychart-beta
  title "Ingresos por canal"
  x-axis [Q1, Q2, Q3, Q4]
  y-axis "Miles de USD" 0 --> 90
  bar [40, 52, 61, 78]
  bar [22, 28, 35, 44]
  bar [11, 14, 19, 25]
`),
  s("Dual Lines", `
xychart-beta
  title "Altas vs. bajas"
  x-axis [Ene, Feb, Mar, Abr, May, Jun]
  y-axis "Clientes" 0 --> 260
  line [120, 150, 185, 205, 230, 250]
  line [18, 22, 27, 24, 31, 29]
`),
  s("Numeric X-Axis", `
xychart-beta
  title "Latencia por percentil"
  x-axis "Percentil" 50 --> 99
  y-axis "ms" 0 --> 900
  line [110, 180, 260, 420, 830]
`),
  s("12-Month Dataset", `
xychart-beta
  title "Facturación mensual"
  x-axis [Ene, Feb, Mar, Abr, May, Jun, Jul, Ago, Sep, Oct, Nov, Dic]
  y-axis "Miles de USD" 0 --> 160
  bar [42, 51, 58, 63, 71, 84, 90, 88, 101, 118, 134, 152]
`),
  s("Horizontal Combined", `
xychart-beta horizontal
  title "Origen de los leads"
  x-axis [Orgánico, Ads, Referidos, Email, Social]
  y-axis "Leads" 0 --> 320
  bar [310, 224, 158, 96, 61]
  line [280, 200, 140, 90, 55]
`),
  s("Sprint Burndown", `
xychart-beta
  title "Burndown del sprint"
  x-axis [D1, D2, D3, D4, D5, D6, D7, D8, D9, D10]
  y-axis "Puntos restantes" 0 --> 60
  line [55, 50, 46, 39, 35, 28, 22, 15, 8, 0]
  line [55, 49, 44, 38, 33, 27, 22, 16, 11, 5]
`),
];

export const MERMAID_SAMPLE_GROUPS: readonly MermaidSampleGroup[] = [
  { family: "Flowchart", samples: flowchart },
  { family: "State", samples: state },
  { family: "Sequence", samples: sequence },
  { family: "Class", samples: classDiagram },
  { family: "ER", samples: er },
  { family: "XY Chart", samples: xychart },
];

export const MERMAID_SAMPLES: readonly MermaidSample[] = MERMAID_SAMPLE_GROUPS.flatMap(
  (group) => group.samples,
);
