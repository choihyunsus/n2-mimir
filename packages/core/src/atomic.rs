// Transactions compose with an enclosing extension operation without losing atomicity.
use rusqlite::{Connection, Savepoint, Transaction, TransactionBehavior};
use std::ops::Deref;

pub enum AtomicWrite<'a> {
    Transaction(Transaction<'a>),
    Savepoint(Savepoint<'a>),
}

impl<'a> AtomicWrite<'a> {
    pub fn new(connection: &'a mut Connection) -> rusqlite::Result<Self> {
        if connection.is_autocommit() {
            Ok(Self::Transaction(Transaction::new(
                connection,
                TransactionBehavior::Immediate,
            )?))
        } else {
            Ok(Self::Savepoint(Savepoint::new(connection)?))
        }
    }

    pub fn commit(self) -> rusqlite::Result<()> {
        match self {
            Self::Transaction(transaction) => transaction.commit(),
            Self::Savepoint(savepoint) => savepoint.commit(),
        }
    }
}

impl Deref for AtomicWrite<'_> {
    type Target = Connection;
    fn deref(&self) -> &Self::Target {
        match self {
            Self::Transaction(transaction) => transaction,
            Self::Savepoint(savepoint) => savepoint,
        }
    }
}
