// Parameterized SQLite access for shared TypeScript extension logic.
use napi::{Error, Result};
use napi_derive::napi;
use rusqlite::{params_from_iter, types::Value};
use serde_json::{Map, Value as Json};

fn parameters(json: &str) -> std::result::Result<Vec<Value>, Box<dyn std::error::Error>> {
    let values: Vec<Json> = serde_json::from_str(json)?;
    values
        .into_iter()
        .map(|value| match value {
            Json::Null => Ok(Value::Null),
            Json::String(text) => Ok(Value::Text(text)),
            Json::Number(number) => {
                if let Some(integer) = number.as_i64() {
                    return Ok(Value::Integer(integer));
                }
                number
                    .as_f64()
                    .filter(|value| value.is_finite())
                    .map(Value::Real)
                    .ok_or_else(|| "Invalid SQL number".into())
            }
            _ => Err("SQL parameters must be null, string or finite number".into()),
        })
        .collect()
}

#[napi]
pub fn execute_sql(handle: i64, sql: String, values: String) -> Result<u32> {
    crate::db::with_conn(handle, |conn| {
        let parameters = parameters(&values)?;
        Ok(conn.execute(&sql, params_from_iter(parameters))? as u32)
    })
    .map_err(|error| Error::from_reason(error.to_string()))
}

#[napi]
pub fn query_sql(handle: i64, sql: String, values: String) -> Result<String> {
    crate::db::with_conn(handle, |conn| {
        let parameters = parameters(&values)?;
        let mut statement = conn.prepare(&sql)?;
        if !statement.readonly() {
            return Err("querySql requires a read-only statement".into());
        }
        let columns: Vec<String> = statement
            .column_names()
            .map(|name| name.to_string())
            .collect();
        let rows = statement
            .query_map(params_from_iter(parameters), |row| {
                let mut object = Map::new();
                for (index, name) in columns.iter().enumerate() {
                    let value = match row.get::<_, Value>(index)? {
                        Value::Null => Json::Null,
                        Value::Integer(value) => Json::from(value),
                        Value::Real(value) => Json::from(value),
                        Value::Text(value) => Json::from(value),
                        Value::Blob(value) => Json::from(value),
                    };
                    object.insert(name.clone(), value);
                }
                Ok(object)
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(serde_json::to_string(&rows)?)
    })
    .map_err(|error| Error::from_reason(error.to_string()))
}
