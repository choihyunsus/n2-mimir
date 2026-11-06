// Bound owner identifiers for native SQLite queries.
use rusqlite::ToSql;
use serde::Deserialize;

#[derive(Default, Deserialize)]
pub(crate) struct Scope {
    pub project: Option<String>,
    pub agent: Option<String>,
}

impl Scope {
    pub fn parse(json: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let value: serde_json::Value = serde_json::from_str(json)?;
        for key in ["project", "agent"] {
            if value
                .get(key)
                .is_some_and(|item| item.as_str().is_none_or(|text| text.trim().is_empty()))
            {
                return Err("Scope identifiers must be nonempty strings".into());
            }
        }
        let scope: Self = serde_json::from_str(json)?;
        if [&scope.project, &scope.agent]
            .into_iter()
            .flatten()
            .any(|value| value.trim().is_empty())
        {
            return Err("Scope identifiers must be nonempty strings".into());
        }
        Ok(scope)
    }

    pub fn append(&self, values: &mut Vec<Box<dyn ToSql>>) {
        values.push(Box::new(self.project.clone()));
        values.push(Box::new(self.project.clone()));
        values.push(Box::new(self.agent.clone()));
        values.push(Box::new(self.agent.clone()));
    }
}

pub(crate) const EXPERIENCE_SCOPE: &str = "(? IS NULL OR e.project=?) AND (? IS NULL OR e.agent=?)";
