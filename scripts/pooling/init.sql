-- This file runs only in the disposable pooling test container.
ALTER DATABASE bazaar_hardening_ci SET bazaar.pooling_fixture = 'isolated';
CREATE ROLE pool_worker LOGIN PASSWORD 'pool_worker_test_only' CONNECTION LIMIT 4;
