import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { AdminApiConfig } from "../config.js";

export const ADMIN_API_CONFIG = Symbol("spacey.admin-api-config");

export interface AdminSqlClient {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}

export interface AdminDatabase {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
  transaction<T>(operation: (client: AdminSqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const ADMIN_DATABASE = Symbol("spacey.admin-database");

@Injectable()
export class PostgresAdminDatabase implements AdminDatabase, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(ADMIN_API_CONFIG) config: AdminApiConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.databasePoolMax,
      application_name: "spacey-admin-api",
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  query<R extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, [...values]);
  }

  async transaction<T>(operation: (client: AdminSqlClient) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
