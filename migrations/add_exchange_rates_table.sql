-- Create table to store exchange rates
CREATE TABLE IF NOT EXISTS exchange_rates (
    currency_code TEXT PRIMARY KEY,
    rate_to_usd REAL NOT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'manual'
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_exchange_rates_updated ON exchange_rates(last_updated);

-- Insert initial rates (these will be updated automatically)
INSERT OR REPLACE INTO exchange_rates (currency_code, rate_to_usd, source) VALUES
    ('USD', 1.0, 'base'),
    ('EUR', 0.85, 'initial'),
    ('GBP', 0.73, 'initial'),
    ('JPY', 110, 'initial'),
    ('CNY', 6.45, 'initial'),
    ('SGD', 1.35, 'initial'),
    ('INR', 75, 'initial'),
    ('AUD', 1.35, 'initial'),
    ('CAD', 1.25, 'initial'),
    ('KRW', 1200, 'initial'),
    ('THB', 33, 'initial'),
    ('MYR', 4.2, 'initial'),
    ('PHP', 52, 'initial'),
    ('IDR', 14500, 'initial'),
    ('VND', 23000, 'initial'),
    ('HKD', 7.8, 'initial'),
    ('TWD', 28, 'initial'),
    ('NZD', 1.45, 'initial'),
    ('CHF', 0.92, 'initial'),
    ('SEK', 8.8, 'initial'),
    ('NOK', 8.5, 'initial'),
    ('DKK', 6.3, 'initial'),
    ('ZAR', 15, 'initial'),
    ('AED', 3.67, 'initial'),
    ('SAR', 3.75, 'initial'),
    ('BRL', 5.2, 'initial'),
    ('MXN', 20, 'initial'),
    ('TRY', 18, 'initial'),
    ('RUB', 75, 'initial');