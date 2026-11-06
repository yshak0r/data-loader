import { DatabaseConfig } from '../types/dcloader';

export interface IafConnectionString {
  name: string; // e.g. "FIN", "MAN"
  schema: string; // e.g. "FIN"
  connectionString: string;
  providerName?: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  isProduction: boolean;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export interface IafEnvironment {
  id: string; // e.g. "DEV", "UAT", "PROD"
  description: string;
  isProduction: boolean;
  appServer?: {
    hostname?: string;
    port?: number;
    application?: string;
  };
  connectionStrings: IafConnectionString[];
}

export interface IafParseResult {
  success: boolean;
  environments: IafEnvironment[];
  error?: string;
  rawXml?: string;
  sourceFileName?: string;
}

/**
 * Split an ADO.NET connection string into key=value pairs, respecting quotes.
 */
function splitAdoNetPairs(cs: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < cs.length; i++) {
    const ch = cs[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
    } else if (ch === ';' && !inSingleQuote && !inDoubleQuote) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * Parses standard ADO.NET / MSSQL connection string
 */
export function parseAdoNetConnectionString(cs: string): Partial<DatabaseConfig> & { parseError?: string } {
  if (!cs || !cs.trim()) return {};
  try {
    const map: Record<string, string> = {};
    const pairs = splitAdoNetPairs(cs);

    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const key = pair.slice(0, eq).trim().toLowerCase().replace(/\s+/g, ' ');
      let val = pair.slice(eq + 1).trim();

      // Strip matching quotes if present
      if (
        (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
      ) {
        val = val.slice(1, -1);
      }

      map[key] = val;
    }

    let rawHost =
      map['server'] ||
      map['data source'] ||
      map['addr'] ||
      map['address'] ||
      map['network address'] ||
      '';

    // Strip "tcp:" prefix if specified (common in Azure/ADO.NET connection strings)
    if (rawHost.toLowerCase().startsWith('tcp:')) {
      rawHost = rawHost.slice(4).trim();
    }

    let host = rawHost;
    let port = 1433;

    if (rawHost.includes(',')) {
      const [h, p] = rawHost.split(',');
      host = h.trim();
      port = parseInt(p.trim(), 10) || 1433;
    } else if (rawHost.includes(':') && !rawHost.includes('::')) {
      const [h, p] = rawHost.split(':');
      host = h.trim();
      port = parseInt(p.trim(), 10) || 1433;
    }

    const explicitPort = map['port'];
    if (explicitPort) {
      const parsedPort = parseInt(explicitPort, 10);
      if (!isNaN(parsedPort) && parsedPort > 0) {
        port = parsedPort;
      }
    }

    const encStr = map['encrypt']?.toLowerCase();
    const isEnc = encStr !== undefined ? encStr === 'true' || encStr === 'yes' || encStr === '1' : undefined;

    const tscStr = (map['trustservercertificate'] || map['trust server certificate'])?.toLowerCase();
    const isTsc = tscStr !== undefined ? tscStr === 'true' || tscStr === 'yes' || tscStr === '1' : undefined;

    const integratedSec = (map['integrated security'] || map['trusted_connection'])?.toLowerCase();
    const isWindowsAuth = integratedSec === 'sspi' || integratedSec === 'true' || integratedSec === 'yes';

    return {
      host: host || undefined,
      port,
      database: map['database'] || map['initial catalog'] || undefined,
      user: map['user id'] || map['uid'] || map['user'] || undefined,
      password: map['password'] || map['pwd'] || undefined,
      authType: isWindowsAuth ? 'windows' : 'sql',
      encrypt: isEnc,
      trustServerCertificate: isTsc,
    };
  } catch (_) {
    return { parseError: 'Could not parse connection string syntax.' };
  }
}

/**
 * Determine if an environment, database, or server host represents Production/Cloud.
 * Cloud databases (e.g. *.database.windows.net) and production servers/catalogs
 * dictate the security policy:
 * - encrypt = true (enforce TLS)
 * - trustServerCertificate = false (verify server CA certificate)
 */
export function isProductionDatabase(
  envId: string,
  envDescription: string,
  databaseName: string,
  hostName: string = ''
): boolean {
  const hostLower = (hostName || '').toLowerCase().trim();

  // 1. Check server host: Any Azure SQL Database (*.database.windows.net, *.database.azure.com)
  // or servers containing 'prd' / 'prod' in their hostname are cloud / production infrastructure.
  const isCloudOrProdHost =
    hostLower.includes('database.windows.net') ||
    hostLower.includes('database.azure.com') ||
    /(?:^|[-_.~])(prd|prod)(?:[-_.~]|$)/i.test(hostLower) ||
    hostLower.includes('prd-db') ||
    hostLower.includes('prod-db') ||
    hostLower.includes('-prd-') ||
    hostLower.includes('_prd_') ||
    hostLower.includes('-prod-') ||
    hostLower.includes('_prod_');

  if (isCloudOrProdHost) {
    return true;
  }

  const envText = `${envId || ''} ${envDescription || ''}`.toLowerCase();

  // Explicit non-production environment terms (only applies if host is not a cloud/prod server)
  const isEnvNonProd = /\b(non-prod|nonprod|dev|development|uat|test|testing|qa|stage|staging|sandbox|demo|local)\b/i.test(envText);

  // 2. Check environment name or description (PROD, PRD, PRODUCTION, LIVE)
  const isEnvProd =
    !isEnvNonProd &&
    (/\b(prod|prd|production|live)\b/i.test(envText) ||
      /^(prod|prd|production|live)/i.test((envId || '').trim()));

  // 3. Check catalog / database name (e.g. sqldb-centralus-prd-ros-client vs dev/uat)
  const dbLower = (databaseName || '').toLowerCase();
  const isDbNonProd = /(?:^|[-_.~])(dev|uat|test|qa|stage|stg|sandbox|demo|local)(?:[-_.~]|$)/i.test(dbLower);
  const isDbProd =
    !isDbNonProd &&
    (/(?:^|[-_.~])(prd|prod|production|live)(?:[-_.~]|$)/i.test(dbLower) ||
      (dbLower.includes('prd') && !dbLower.includes('dev') && !dbLower.includes('uat')));

  return Boolean(isEnvProd || isDbProd);
}

/**
 * Parse IAF XML configuration (<IafConfiguration><Environments>...)
 * Validates XML structure, handles error responses, and extracts database connections.
 */
export function parseIafXml(xmlContent: string, fileName?: string): IafParseResult {
  if (!xmlContent || !xmlContent.trim()) {
    return {
      success: false,
      environments: [],
      error: 'XML content is empty. Please select or paste a valid IAF XML file.',
    };
  }

  try {
    const parser = new DOMParser();
    let xmlDoc = parser.parseFromString(xmlContent, 'application/xml');

    // Check for XML parsing/syntax errors
    let parseError = xmlDoc.querySelector('parsererror');

    // Resilient fallback for legacy Ross ERP XML files:
    // Files often contain unescaped quotes in unrelated sections (e.g. <Common><TOC><GemPerform dml="..." />).
    // If the full document fails, isolate the <Environments> container which houses the database configurations.
    if (parseError) {
      const envsMatch = xmlContent.match(/<Environments[\s\S]*?<\/Environments>/i);
      if (envsMatch) {
        const sanitizedXml = `<IafConfiguration>\n${envsMatch[0]}\n</IafConfiguration>`;
        const recoveryDoc = parser.parseFromString(sanitizedXml, 'application/xml');
        if (!recoveryDoc.querySelector('parsererror')) {
          xmlDoc = recoveryDoc;
          parseError = null;
        }
      }
    }

    if (parseError) {
      const cleanErrMsg = parseError.textContent?.replace(/\s+/g, ' ').slice(0, 200) || 'Invalid XML syntax';
      return {
        success: false,
        environments: [],
        error: `XML syntax error: ${cleanErrMsg}`,
      };
    }

    // Validate root element is <IafConfiguration>
    const rootElement = xmlDoc.documentElement;
    if (!rootElement || rootElement.nodeName.toLowerCase() !== 'iafconfiguration') {
      const actualName = rootElement ? rootElement.nodeName : 'unknown';
      return {
        success: false,
        environments: [],
        error: `Invalid XML format: Expected root element <IafConfiguration>, but found <${actualName}>.`,
      };
    }

    // Validate <Environments> container
    const envsContainer = rootElement.querySelector('Environments');
    if (!envsContainer) {
      return {
        success: false,
        environments: [],
        error: 'Invalid IAF configuration: Missing <Environments> section in <IafConfiguration>.',
      };
    }

    // Query <Environment> elements under <Environments>
    const envElements = envsContainer.querySelectorAll(':scope > Environment, Environment');
    if (envElements.length === 0) {
      return {
        success: false,
        environments: [],
        error: 'Invalid IAF configuration: No <Environment> elements found inside <Environments>.',
      };
    }

    const environments: IafEnvironment[] = [];
    const missingConnEnvIds: string[] = [];

    envElements.forEach((envNode) => {
      const id = (envNode.getAttribute('id') || envNode.getAttribute('name') || '').trim();
      const description = (envNode.getAttribute('description') || id || 'Unnamed Environment').trim();

      if (!id) {
        return; // Skip invalid environment nodes without id
      }

      // Optional ConnectXpo / App Server details
      let appServer: IafEnvironment['appServer'] | undefined = undefined;
      const connectXpo = envNode.querySelector('ConnectXpo');
      if (connectXpo) {
        const hostname = connectXpo.querySelector('Ipcname > Hostname')?.textContent?.trim();
        const portStr = connectXpo.querySelector('Ipcname > Port')?.textContent?.trim();
        const app = connectXpo.querySelector('Application')?.textContent?.trim();
        const port = portStr ? parseInt(portStr, 10) : undefined;
        if (hostname || port || app) {
          appServer = { hostname, port: isNaN(port!) ? undefined : port, application: app };
        }
      }

      // Query connection strings
      const connNodes = envNode.querySelectorAll('ConnectionStrings > ConnectionString, ConnectionString');
      const connectionStrings: IafConnectionString[] = [];

      connNodes.forEach((connNode) => {
        const name = (connNode.getAttribute('name') || 'DEFAULT').trim();
        const schema = (connNode.getAttribute('schema') || name).trim();
        const rawConnStr = (connNode.getAttribute('connectionString') || '').trim();
        const providerName = connNode.getAttribute('providerName') || undefined;

        if (rawConnStr) {
          const parsed = parseAdoNetConnectionString(rawConnStr);
          const host = parsed.host || '';
          const isProd = isProductionDatabase(id, description, parsed.database || '', host);

          // Security policy:
          // 1. Cloud / Production environments (*.database.windows.net, prd-db, or prod catalogs):
          //    encrypt = true (enforce TLS), trustServerCertificate = false (verify CA certificate).
          // 2. Non-production / local dev:
          //    encrypt = parsed.encrypt ?? false, trustServerCertificate = parsed.trustServerCertificate ?? true.
          const encrypt = isProd ? true : (parsed.encrypt ?? false);
          const trustServerCertificate = isProd ? false : (parsed.trustServerCertificate ?? true);

          connectionStrings.push({
            name,
            schema,
            connectionString: rawConnStr,
            providerName,
            host,
            port: parsed.port || 1433,
            database: parsed.database || '',
            user: parsed.user || '',
            password: parsed.password || '',
            isProduction: isProd,
            encrypt,
            trustServerCertificate,
          });
        }
      });

      if (connectionStrings.length > 0) {
        const envIsProd =
          connectionStrings.some((c) => c.isProduction) ||
          isProductionDatabase(id, description, '');

        environments.push({
          id,
          description,
          isProduction: envIsProd,
          appServer,
          connectionStrings,
        });
      } else {
        missingConnEnvIds.push(id);
      }
    });

    if (environments.length === 0) {
      if (missingConnEnvIds.length > 0) {
        return {
          success: false,
          environments: [],
          error: `Found environment(s) [${missingConnEnvIds.join(', ')}], but none have valid <ConnectionString connectionString="..." /> entries.`,
        };
      }
      return {
        success: false,
        environments: [],
        error: 'No valid <ConnectionString> entries found under any <Environment>. Expected <ConnectionStrings><ConnectionString ... />.',
      };
    }

    return {
      success: true,
      environments,
      rawXml: xmlContent,
      sourceFileName: fileName,
    };
  } catch (err: any) {
    return {
      success: false,
      environments: [],
      error: `Failed to parse IAF XML: ${err.message || 'Unknown error'}`,
    };
  }
}
