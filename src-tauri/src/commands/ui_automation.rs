// Read-only Windows UI Automation tree reader, used by Control Me's
// `read_ui_elements` tool (controlme.rs) as a cheaper/more precise
// alternative to a screenshot when Gemini needs exact text or an element's
// position rather than a full visual read of the screen. Complements
// `computer_use`, never replaces it — a canvas/game-drawn UI simply won't
// expose anything here, which is expected, not a bug.
//
// Uses the `uiautomation` crate (a maintained wrapper around the
// IUIAutomation COM interfaces, API verified against its real source before
// writing this) rather than hand-rolled COM calls — same reasoning as the
// enigo/xcap choices elsewhere in this file's sibling module. It pins its
// own `windows = "0.62"` internally, distinct from this crate's own
// `windows = "0.61"` (used only for the WebView2 Ctrl+S fix in lib.rs) — no
// conflict, since the only value crossing that boundary is a raw HWND
// pointer value (via `Handle::from(isize)`), not a shared COM object.
use uiautomation::types::Handle;
use uiautomation::{UIAutomation, UIElement, UITreeWalker};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

// Safety valves against a pathologically large accessibility tree (a
// browser mirrors its whole DOM into one) — whichever cap is hit first
// stops the walk. Not exhaustively tuned against real UIs (no GUI access in
// this environment); adjust if real usage shows either is off.
const MAX_DEPTH: u32 = 6;
const MAX_ELEMENTS: usize = 60;
const MAX_VISITED: usize = 500;

fn normalize(coord: i32, dimension: u32) -> i32 {
    if dimension == 0 {
        return 0;
    }
    ((coord as f64 / dimension as f64) * 999.0).round().clamp(0.0, 999.0) as i32
}

struct WalkBudget {
    recorded: usize,
    visited: usize,
}

fn walk(
    walker: &UITreeWalker,
    element: &UIElement,
    depth: u32,
    screen_width: u32,
    screen_height: u32,
    budget: &mut WalkBudget,
    out: &mut Vec<String>,
) {
    if budget.visited >= MAX_VISITED || budget.recorded >= MAX_ELEMENTS {
        return;
    }
    budget.visited += 1;

    // Depth 0 is the window root itself (already used for the title line),
    // not listed again as a control.
    if depth > 0 {
        let is_control = element.is_control_element().unwrap_or(false);
        let onscreen = !element.is_offscreen().unwrap_or(true);
        if is_control && onscreen {
            let name = element.get_name().unwrap_or_default();
            let automation_id = element.get_automation_id().unwrap_or_default();
            let label = if !name.trim().is_empty() {
                Some(name.trim().to_string())
            } else if !automation_id.trim().is_empty() {
                Some(automation_id.trim().to_string())
            } else {
                None
            };
            if let (Some(label), Ok(rect)) = (label, element.get_bounding_rectangle()) {
                let control_type = element
                    .get_localized_control_type()
                    .unwrap_or_else(|_| "élément".to_string());
                let enabled = element.is_enabled().unwrap_or(true);
                let cx = rect.get_left() + rect.get_width() / 2;
                let cy = rect.get_top() + rect.get_height() / 2;
                let nx = normalize(cx, screen_width);
                let ny = normalize(cy, screen_height);
                let state = if enabled { "activé" } else { "désactivé" };
                let label = if label.len() > 80 { format!("{}…", &label[..80]) } else { label };
                out.push(format!("- {control_type} \"{label}\" ({state}) @ ({nx}, {ny})"));
                budget.recorded += 1;
            }
        }
    }

    if depth >= MAX_DEPTH {
        return;
    }
    let Ok(first_child) = walker.get_first_child(element) else {
        return;
    };
    walk(walker, &first_child, depth + 1, screen_width, screen_height, budget, out);
    let mut current = first_child;
    loop {
        if budget.visited >= MAX_VISITED || budget.recorded >= MAX_ELEMENTS {
            break;
        }
        let Ok(sibling) = walker.get_next_sibling(&current) else {
            break;
        };
        walk(walker, &sibling, depth + 1, screen_width, screen_height, budget, out);
        current = sibling;
    }
}

// Returns a compact text snapshot of the foreground window's control tree:
// title line, then one bullet per visible/named control with its type,
// label, enabled state, and center point normalized to the same 0-999
// space `computer_use` coordinates already use — directly reusable for a
// subsequent click without any extra conversion on Gemini's side.
pub fn read_foreground_ui_elements(screen_width: u32, screen_height: u32) -> Result<String, String> {
    let automation = UIAutomation::new().map_err(|e| e.to_string())?;

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return Err("Aucune fenêtre au premier plan détectée.".to_string());
    }
    let handle = Handle::from(hwnd.0 as isize);
    let root = automation.element_from_handle(handle).map_err(|e| e.to_string())?;
    let title = root.get_name().unwrap_or_default();

    let walker = automation.get_control_view_walker().map_err(|e| e.to_string())?;
    let mut budget = WalkBudget { recorded: 0, visited: 0 };
    let mut lines = Vec::new();
    walk(&walker, &root, 0, screen_width, screen_height, &mut budget, &mut lines);

    if lines.is_empty() {
        return Ok(format!(
            "Fenêtre au premier plan : \"{title}\" — aucun contrôle nommé détecté (interface probablement dessinée directement, sans exposition à l'accessibilité)."
        ));
    }

    Ok(format!("Fenêtre au premier plan : \"{title}\"\n{}", lines.join("\n")))
}
