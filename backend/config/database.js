/**
 * Database Configuration - Swarm Coordination Mastery Platform
 * PostgreSQL connection and migration management
 */

const { Pool } = require('pg');
const { logger } = require('../utils/logger');

class DatabaseConfig {
  constructor() {
    this.pool = null;
    this.config = {
      // Connection settings
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'swarm_learning',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      
      // SSL settings
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false,
        ca: process.env.DB_SSL_CA,
        cert: process.env.DB_SSL_CERT,
        key: process.env.DB_SSL_KEY
      } : false,
      
      // Connection pool settings
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      min: parseInt(process.env.DB_POOL_MIN) || 5,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 5000,
      
      // Query timeout
      statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT) || 30000,
      
      // Application name for connection tracking
      application_name: 'swarm_learning_platform'
    };
  }

  /**
   * Initialize database connection pool
   */
  async initialize() {
    try {
      this.pool = new Pool(this.config);
      
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      logger.info('Database connection pool initialized successfully');
      
      // Set up event listeners
      this.setupEventListeners();
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize database connection:', error);
      throw new Error('Database initialization failed');
    }
  }

  /**
   * Set up pool event listeners
   */
  setupEventListeners() {
    this.pool.on('connect', (client) => {
      logger.debug('New database client connected');
    });

    this.pool.on('remove', (client) => {
      logger.debug('Database client removed from pool');
    });

    this.pool.on('error', (err, client) => {
      logger.error('Database pool error:', err);
    });
  }

  /**
   * Get database connection pool
   * @returns {Pool} PostgreSQL connection pool
   */
  getPool() {
    if (!this.pool) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.pool;
  }

  /**
   * Execute a query with optional connection
   * @param {string} text - SQL query
   * @param {Array} params - Query parameters
   * @param {Object} client - Optional client connection
   * @returns {Object} Query result
   */
  async query(text, params = [], client = null) {
    const start = Date.now();
    const queryClient = client || this.pool;
    
    try {
      const result = await queryClient.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Query executed', {
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        duration,
        rows: result.rowCount
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Query failed', {
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        duration,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Begin transaction
   * @returns {Object} Transaction client
   */
  async beginTransaction() {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      logger.debug('Transaction started');
      
      return {
        client,
        query: (text, params) => this.query(text, params, client),
        commit: async () => {
          try {
            await client.query('COMMIT');
            logger.debug('Transaction committed');
          } finally {
            client.release();
          }
        },
        rollback: async () => {
          try {
            await client.query('ROLLBACK');
            logger.debug('Transaction rolled back');
          } finally {
            client.release();
          }
        }
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  /**
   * Execute query with automatic retry
   * @param {string} text - SQL query
   * @param {Array} params - Query parameters
   * @param {number} maxRetries - Maximum number of retries
   * @returns {Object} Query result
   */
  async queryWithRetry(text, params = [], maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.query(text, params);
      } catch (error) {
        lastError = error;
        
        // Don't retry on certain errors
        if (error.code === '23505' || // unique_violation
            error.code === '23503' || // foreign_key_violation
            error.code === '42P01') {  // undefined_table
          throw error;
        }
        
        logger.warn(`Query attempt ${attempt} failed, retrying...`, {
          error: error.message,
          attempt,
          maxRetries
        });
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
    
    throw lastError;
  }

  /**
   * Check database health
   * @returns {Object} Health status
   */
  async healthCheck() {
    try {
      const start = Date.now();
      await this.query('SELECT 1 as health_check');
      const responseTime = Date.now() - start;
      
      return {
        status: 'healthy',
        responseTime,
        poolSize: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        poolSize: this.pool ? this.pool.totalCount : 0,
        idleConnections: this.pool ? this.pool.idleCount : 0,
        waitingCount: this.pool ? this.pool.waitingCount : 0
      };
    }
  }

  /**
   * Get database statistics
   * @returns {Object} Database statistics
   */
  async getDatabaseStats() {
    try {
      const queries = [
        // Connection stats
        `SELECT 
          count(*) as total_connections,
          count(*) filter (where state = 'active') as active_connections,
          count(*) filter (where state = 'idle') as idle_connections
        FROM pg_stat_activity 
        WHERE datname = current_database()`,
        
        // Database size
        `SELECT 
          pg_size_pretty(pg_database_size(current_database())) as database_size,
          pg_database_size(current_database()) as database_size_bytes`,
        
        // Table statistics
        `SELECT 
          schemaname,
          tablename,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_tuples,
          n_dead_tup as dead_tuples,
          last_vacuum,
          last_autovacuum,
          last_analyze,
          last_autoanalyze
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        LIMIT 10`
      ];
      
      const [connectionStats, sizeStats, tableStats] = await Promise.all(
        queries.map(query => this.query(query))
      );
      
      return {
        connections: connectionStats.rows[0],
        size: sizeStats.rows[0],
        tables: tableStats.rows,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to get database statistics:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Close database connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('Database connection pool closed');
    }
  }
}

// Migration utilities
class MigrationManager {
  constructor(db) {
    this.db = db;
  }

  /**
   * Check if migrations table exists
   */
  async ensureMigrationsTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await this.db.query(query);
  }

  /**
   * Get executed migrations
   */
  async getExecutedMigrations() {
    await this.ensureMigrationsTable();
    
    const result = await this.db.query(
      'SELECT name FROM migrations ORDER BY executed_at'
    );
    
    return result.rows.map(row => row.name);
  }

  /**
   * Mark migration as executed
   */
  async markMigrationExecuted(name) {
    await this.db.query(
      'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [name]
    );
  }

  /**
   * Run pending migrations
   */
  async runMigrations(migrationFiles) {
    const executedMigrations = await this.getExecutedMigrations();
    const pendingMigrations = migrationFiles.filter(
      file => !executedMigrations.includes(file.name)
    );
    
    if (pendingMigrations.length === 0) {
      logger.info('No pending migrations');
      return;
    }
    
    logger.info(`Running ${pendingMigrations.length} pending migrations`);
    
    for (const migration of pendingMigrations) {
      const transaction = await this.db.beginTransaction();
      
      try {
        logger.info(`Running migration: ${migration.name}`);
        await transaction.query(migration.sql);
        await this.markMigrationExecuted(migration.name);
        await transaction.commit();
        
        logger.info(`Migration completed: ${migration.name}`);
      } catch (error) {
        await transaction.rollback();
        logger.error(`Migration failed: ${migration.name}`, error);
        throw error;
      }
    }
  }
}

// Seed data utilities
class SeedManager {
  constructor(db) {
    this.db = db;
  }

  /**
   * Check if database has been seeded
   */
  async isSeeded() {
    const result = await this.db.query(
      'SELECT COUNT(*) as count FROM users WHERE role = $1',
      ['admin']
    );
    
    return result.rows[0].count > 0;
  }

  /**
   * Seed initial data
   */
  async seedInitialData() {
    if (await this.isSeeded()) {
      logger.info('Database already seeded, skipping...');
      return;
    }

    const transaction = await this.db.beginTransaction();
    
    try {
      logger.info('Seeding initial data...');
      
      // Create admin user
      const adminQuery = `
        INSERT INTO users (email, password_hash, role, first_name, last_name, is_verified)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `;
      
      const adminResult = await transaction.query(adminQuery, [
        'admin@swarmlearning.com',
        '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/lewEzNWGkQBwMu9z2', // password: admin123
        'admin',
        'System',
        'Administrator',
        true
      ]);
      
      const adminId = adminResult.rows[0].id;
      
      // Create sample courses
      const courseQueries = [
        {
          title: 'Swarm Coordination Fundamentals',
          description: 'Learn the basics of swarm coordination and multi-agent systems',
          level: 'beginner',
          duration: 240,
          slug: 'swarm-coordination-fundamentals'
        },
        {
          title: 'Advanced Neural Patterns',
          description: 'Master advanced neural patterns and cognitive architectures',
          level: 'intermediate',
          duration: 480,
          slug: 'advanced-neural-patterns'
        },
        {
          title: 'Enterprise SPARC Methodology',
          description: 'Implement SPARC methodology for enterprise applications',
          level: 'advanced',
          duration: 720,
          slug: 'enterprise-sparc-methodology'
        }
      ];
      
      for (const course of courseQueries) {
        await transaction.query(`
          INSERT INTO courses (title, description, level, duration_minutes, created_by, is_published, slug)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [course.title, course.description, course.level, course.duration, adminId, true, course.slug]);
      }
      
      await transaction.commit();
      logger.info('Initial data seeded successfully');
      
    } catch (error) {
      await transaction.rollback();
      logger.error('Failed to seed initial data:', error);
      throw error;
    }
  }
}

// Export singleton instance
const dbConfig = new DatabaseConfig();

module.exports = {
  DatabaseConfig,
  MigrationManager,
  SeedManager,
  db: dbConfig
};