export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Lit le contenu texte d'un fichier. Utilise un chemin absolu.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin absolu du fichier à lire" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "Liste le contenu (fichiers et dossiers) d'un seul niveau de dossier. Utilise un chemin absolu.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin absolu du dossier à lister" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Crée ou écrase entièrement un fichier avec le contenu donné. Utilise un chemin absolu.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin absolu du fichier à écrire" },
          content: { type: "string", description: "Contenu complet du fichier" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Remplace un texte exact par un autre dans un fichier existant. old_string doit apparaître exactement une fois dans le fichier, sauf si replace_all vaut true. Préfère cet outil à write_file pour des modifications ciblées.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin absolu du fichier à modifier" },
          old_string: { type: "string", description: "Texte exact à remplacer (doit être unique dans le fichier sauf si replace_all=true)" },
          new_string: { type: "string", description: "Texte de remplacement" },
          replace_all: { type: "boolean", description: "Remplacer toutes les occurrences au lieu d'exiger l'unicité (défaut: false)" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_powershell_command",
      description: "Exécute une commande PowerShell sur le PC de l'utilisateur et retourne sa sortie. Timeout par défaut 120s.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Commande PowerShell à exécuter" },
          cwd: { type: "string", description: "Dossier de travail absolu (optionnel)" },
          timeout_secs: { type: "number", description: "Timeout en secondes (optionnel, défaut 120)" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user_question",
      description:
        "Pose une question à l'utilisateur et attend sa réponse avant de continuer. Utilise ceci quand une décision ou une précision de l'utilisateur est nécessaire.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "La question à poser" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Choix proposés (optionnel) ; l'utilisateur peut aussi répondre librement",
          },
        },
        required: ["question"],
      },
    },
  },
];

export const MUTATING_TOOLS = new Set(["write_file", "edit_file", "run_powershell_command"]);
export const READONLY_TOOLS = new Set(["read_file", "list_dir"]);
export const ASK_USER_TOOL = "ask_user_question";

export const MAX_AGENT_ITERATIONS = 25;

export const CODEX_SYSTEM_PROMPT = `Tu es un agent de codage local qui aide l'utilisateur à lire et modifier du code sur son PC.
Utilise les outils fournis : read_file et list_dir pour explorer, edit_file pour des modifications ciblées (préfère-le à write_file dès qu'un fichier existe déjà), write_file uniquement pour créer un nouveau fichier ou le réécrire entièrement, run_powershell_command pour exécuter des commandes, et ask_user_question dès que tu as besoin d'une précision ou d'une décision de l'utilisateur avant de continuer.
Explique brièvement ce que tu fais avant d'agir. Ne suppose jamais le contenu d'un fichier que tu n'as pas lu.`;
