// Throwaway benchmark for Control Me's windows_ui perception mode.
//
// Round 1 taught the important lesson: FindAllBuildCache(TreeScope::Subtree)
// looks like the textbook UIA optimisation but took 17 SECONDS once the
// target's accessibility tree was actually populated, because Subtree forces
// the provider to materialise the whole tree. It is not usable here.
//
// This version measures, on a deliberately warmed tree so the numbers are
// comparable:
//   [A] the current per-element walk (9-ish cross-process calls per element)
//   [C] the same depth/visited-bounded walk, but fetching each level's
//       children in ONE cached call (properties included) instead of
//       per-property cross-process reads
// Run: cargo run --release --example uia_bench
use std::time::Instant;
use uiautomation::types::{ElementMode, TreeScope, UIProperty};
use uiautomation::variants::Variant;
use uiautomation::{UIAutomation, UIElement, UITreeWalker};

const MAX_DEPTH: u32 = 6;
const MAX_ELEMENTS: usize = 60;
const MAX_VISITED: usize = 500;

struct WalkBudget {
    recorded: usize,
    visited: usize,
}

// --- [A] current implementation, copied from ui_automation.rs ---
fn walk(walker: &UITreeWalker, element: &UIElement, depth: u32, budget: &mut WalkBudget, out: &mut Vec<String>) {
    if budget.visited >= MAX_VISITED || budget.recorded >= MAX_ELEMENTS {
        return;
    }
    budget.visited += 1;

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
            if let (Some(label), Ok(_rect)) = (label, element.get_bounding_rectangle()) {
                let control_type = element.get_localized_control_type().unwrap_or_else(|_| "élément".into());
                let _enabled = element.is_enabled().unwrap_or(true);
                out.push(format!("{control_type} \"{label}\""));
                budget.recorded += 1;
            }
        }
    }

    if depth >= MAX_DEPTH {
        return;
    }
    let Ok(first_child) = walker.get_first_child(element) else { return };
    walk(walker, &first_child, depth + 1, budget, out);
    let mut current = first_child;
    loop {
        if budget.visited >= MAX_VISITED || budget.recorded >= MAX_ELEMENTS {
            break;
        }
        let Ok(sibling) = walker.get_next_sibling(&current) else { break };
        walk(walker, &sibling, depth + 1, budget, out);
        current = sibling;
    }
}

// --- [C] level-by-level, one cached call per parent ---
fn walk_cached(
    automation: &UIAutomation,
    element: &UIElement,
    depth: u32,
    budget: &mut WalkBudget,
    out: &mut Vec<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    if depth >= MAX_DEPTH || budget.visited >= MAX_VISITED || budget.recorded >= MAX_ELEMENTS {
        return Ok(());
    }

    let cache_request = automation.create_cache_request()?;
    // Children only — never Subtree. Subtree is what cost 17 seconds.
    cache_request.set_tree_scope(TreeScope::Children)?;
    // Sans Full, les elements renvoyes sont "cache-only" et toute
    // navigation autre que GetCachedParent/GetCachedChildren echoue -- ce
    // qui faisait planter la version precedente de ce banc.
    cache_request.set_element_mode(ElementMode::Full)?;
    for property in [
        UIProperty::Name,
        UIProperty::AutomationId,
        UIProperty::BoundingRectangle,
        UIProperty::LocalizedControlType,
        UIProperty::IsEnabled,
        UIProperty::IsOffscreen,
        UIProperty::IsControlElement,
    ] {
        cache_request.add_property(property)?;
    }
    let condition = automation.create_true_condition()?;
    let children = element.find_all_build_cache(TreeScope::Children, &condition, &cache_request)?;

    for child in children.iter() {
        if budget.visited >= MAX_VISITED || budget.recorded >= MAX_ELEMENTS {
            break;
        }
        budget.visited += 1;

        let is_control = child
            .get_cached_property_value(UIProperty::IsControlElement)
            .ok()
            .and_then(|v| TryInto::<bool>::try_into(v).ok())
            .unwrap_or(false);
        let offscreen = child
            .get_cached_property_value(UIProperty::IsOffscreen)
            .ok()
            .and_then(|v| TryInto::<bool>::try_into(v).ok())
            .unwrap_or(true);
        if is_control && !offscreen {
            let name = child.get_cached_name().unwrap_or_default();
            let automation_id = child.get_cached_automation_id().unwrap_or_default();
            let label = if !name.trim().is_empty() {
                Some(name.trim().to_string())
            } else if !automation_id.trim().is_empty() {
                Some(automation_id.trim().to_string())
            } else {
                None
            };
            if let (Some(label), Ok(_rect)) = (label, child.get_cached_bounding_rectangle()) {
                let control_type = child.get_cached_localized_control_type().unwrap_or_else(|_| "élément".into());
                let _enabled = child
                    .get_cached_property_value(UIProperty::IsEnabled)
                    .ok()
                    .and_then(|v| TryInto::<bool>::try_into(v).ok())
                    .unwrap_or(true);
                out.push(format!("{control_type} \"{label}\""));
                budget.recorded += 1;
            }
        }
        walk_cached(automation, child, depth + 1, budget, out)?;
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let automation = UIAutomation::new()?;
    let root = automation.get_root_element()?;
    let walker = automation.get_control_view_walker()?;

    let mut candidates: Vec<(String, UIElement)> = Vec::new();
    if let Ok(first) = walker.get_first_child(&root) {
        let mut cur = first;
        loop {
            let name = cur.get_name().unwrap_or_default();
            if !name.trim().is_empty() {
                candidates.push((name, cur.clone()));
            }
            let Ok(next) = walker.get_next_sibling(&cur) else { break };
            cur = next;
        }
    }
    println!("Fenêtres de premier niveau : {}", candidates.len());
    for (name, _) in candidates.iter() {
        println!("  - {name}");
    }
    println!();

    for (name, target) in candidates.iter() {
        let short: String = name.chars().take(46).collect();
        println!("== {short} ==");

        // Warm the tree first so cold-vs-warm doesn't skew the comparison
        // (that confound is exactly what made the first benchmark
        // misleading: the current walk was measured on a lazy, near-empty
        // tree and the alternative on a fully populated one).
        {
            let mut budget = WalkBudget { recorded: 0, visited: 0 };
            let mut lines = Vec::new();
            walk(&walker, target, 0, &mut budget, &mut lines);
        }

        for round in 1..=3 {
            let start = Instant::now();
            let mut budget = WalkBudget { recorded: 0, visited: 0 };
            let mut lines = Vec::new();
            walk(&walker, target, 0, &mut budget, &mut lines);
            println!(
                "  [A] walk actuel   #{round} : {:>7.0} ms ({} visités, {} retenus)",
                start.elapsed().as_secs_f64() * 1000.0,
                budget.visited,
                budget.recorded
            );
        }

        for round in 1..=3 {
            let start = Instant::now();
            let mut budget = WalkBudget { recorded: 0, visited: 0 };
            let mut lines = Vec::new();
            let res = walk_cached(&automation, target, 0, &mut budget, &mut lines);
            match res {
                Ok(()) => println!(
                    "  [C] walk cache    #{round} : {:>7.0} ms ({} visités, {} retenus)",
                    start.elapsed().as_secs_f64() * 1000.0,
                    budget.visited,
                    budget.recorded
                ),
                Err(e) => println!("  [C] walk cache    #{round} : erreur {e}"),
            }
        }
        println!();
    }

    // Keep the Variant import meaningful even if unused above.
    let _ = Variant::from(true);
    Ok(())
}
