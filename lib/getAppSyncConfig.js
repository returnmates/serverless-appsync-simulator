"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getAppSyncConfig;

var _amplifyAppsyncSimulator = require("amplify-appsync-simulator");

var _axios = _interopRequireDefault(require("axios"));

var _fs = _interopRequireDefault(require("fs"));

var _lodash = require("lodash");

var _path = _interopRequireDefault(require("path"));

var _mergeGraphqlSchemas = require("merge-graphql-schemas");

var globby = _interopRequireWildcard(require("globby"));

function _getRequireWildcardCache() { if (typeof WeakMap !== "function") return null; var cache = new WeakMap(); _getRequireWildcardCache = function () { return cache; }; return cache; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* babel-plugin-inline-import './templates/direct-lambda.request.vtl' */
const directLambdaRequest = "## Direct lambda request\n{\n    \"version\": \"2018-05-29\",\n    \"operation\": \"Invoke\",\n    \"payload\": $utils.toJson($context)\n}\n";

/* babel-plugin-inline-import './templates/direct-lambda.response.vtl' */
const directLambdaResponse = "## Direct lambda response\n#if($ctx.error)\n    $util.error($ctx.error.message, $ctx.error.type, $ctx.result)\n#end\n$util.toJson($ctx.result)\n";
const directLambdaMappingTemplates = {
  request: directLambdaRequest,
  response: directLambdaResponse
};

function getAppSyncConfig(context, appSyncConfig) {
  // Flattening params
  const cfg = { ...appSyncConfig,
    mappingTemplates: (appSyncConfig.mappingTemplates || []).flat(),
    functionConfigurations: (appSyncConfig.functionConfigurations || []).flat(),
    dataSources: (appSyncConfig.dataSources || []).flat()
  };

  const mappingTemplatesLocation = _path.default.join(context.serverless.config.servicePath, cfg.mappingTemplatesLocation || 'mapping-templates');

  const {
    defaultMappingTemplates = {}
  } = cfg;

  const getMappingTemplate = filePath => {
    return _fs.default.readFileSync(_path.default.join(mappingTemplatesLocation, filePath), {
      encoding: 'utf8'
    });
  };

  const toAbsolutePosixPath = (basePath, filePath) => (_path.default.isAbsolute(filePath) ? filePath : _path.default.join(basePath, filePath)).replace(/\\/g, '/');

  const globFilePaths = (basePath, filePaths) => {
    return filePaths.map(filePath => {
      const paths = globby.sync(toAbsolutePosixPath(basePath, filePath));

      if (_path.default.isAbsolute(filePath)) {
        return paths;
      } else {
        // For backward compatibility with FileMap, revert to relative path
        return paths.map(p => _path.default.relative(basePath, p));
      }
    }).flat();
  };

  const getFileMap = (basePath, filePath) => ({
    path: filePath,
    content: _fs.default.readFileSync(toAbsolutePosixPath(basePath, filePath), {
      encoding: 'utf8'
    })
  });

  const makeDataSource = source => {
    if (source.name === undefined || source.type === undefined) {
      return null;
    }

    const dataSource = {
      name: source.name,
      type: source.type
    };

    switch (source.type) {
      case 'AMAZON_DYNAMODB':
        {
          return { ...dataSource,
            config: { ...context.options.dynamoDb,
              tableName: source.config.tableName
            }
          };
        }

      case 'RELATIONAL_DATABASE':
        {
          return { ...dataSource,
            rds: context.options.rds
          };
        }

      case 'AWS_LAMBDA':
        {
          var _conf$functions, _context$serverless$s;

          const {
            functionName
          } = source.config;

          if (functionName === undefined) {
            context.plugin.log(`${source.name} does not have a functionName`, {
              color: 'orange'
            });
            return null;
          }

          const conf = context.options;
          const func = ((_conf$functions = conf.functions) === null || _conf$functions === void 0 ? void 0 : _conf$functions[functionName]) || ((_context$serverless$s = context.serverless.service.functions) === null || _context$serverless$s === void 0 ? void 0 : _context$serverless$s[functionName]);

          if (func === undefined) {
            context.plugin.log(`The ${functionName} function is not defined`, {
              color: 'orange'
            });
            return null;
          }

          let url, method;

          if (func.url) {
            url = func.url;
            method = func.method;
          } else {
            url = `http://localhost:${context.options.lambdaPort}/2015-03-31/functions/${func.name}/invocations`;
          }

          return { ...dataSource,
            invoke: async payload => {
              var _payload$request;

              const result = await _axios.default.request({
                url,
                method: method || 'POST',
                data: payload,
                headers: (_payload$request = payload.request) === null || _payload$request === void 0 ? void 0 : _payload$request.headers,
                validateStatus: false
              });
              return result.data;
            }
          };
        }

      case 'AMAZON_ELASTICSEARCH':
      case 'HTTP':
        {
          return { ...dataSource,
            endpoint: source.config.endpoint
          };
        }

      default:
        return dataSource;
    }
  };

  const makeMappingTemplate = (resolver, type) => {
    const {
      name,
      type: parent,
      field,
      substitutions = {}
    } = resolver;
    const defaultTemplatePrefix = name || `${parent}.${field}`;
    const templatePath = !(0, _lodash.isNil)(resolver === null || resolver === void 0 ? void 0 : resolver[type]) ? resolver === null || resolver === void 0 ? void 0 : resolver[type] : !(0, _lodash.isNil)(defaultMappingTemplates === null || defaultMappingTemplates === void 0 ? void 0 : defaultMappingTemplates[type]) ? defaultMappingTemplates === null || defaultMappingTemplates === void 0 ? void 0 : defaultMappingTemplates[type] : `${defaultTemplatePrefix}.${type}.vtl`;
    let mappingTemplate; // Direct lambda
    // For direct lambdas, we use a default mapping template
    // See https://amzn.to/3ncV3Dz

    if (templatePath === false) {
      mappingTemplate = directLambdaMappingTemplates[type];
    } else {
      mappingTemplate = getMappingTemplate(templatePath); // Substitutions

      const allSubstitutions = { ...cfg.substitutions,
        ...substitutions
      };
      (0, _lodash.forEach)(allSubstitutions, (value, variable) => {
        const regExp = new RegExp(`\\$\{?${variable}}?`, 'g');
        mappingTemplate = mappingTemplate.replace(regExp, value);
      });
    }

    return mappingTemplate;
  };

  const makeResolver = resolver => {
    return {
      kind: resolver.kind || 'UNIT',
      fieldName: resolver.field,
      typeName: resolver.type,
      dataSourceName: resolver.dataSource,
      functions: resolver.functions,
      requestMappingTemplate: makeMappingTemplate(resolver, 'request'),
      responseMappingTemplate: makeMappingTemplate(resolver, 'response')
    };
  };

  const makeFunctionConfiguration = config => ({
    dataSourceName: config.dataSource,
    name: config.name,
    requestMappingTemplate: makeMappingTemplate(config, 'request'),
    responseMappingTemplate: makeMappingTemplate(config, 'response')
  });

  const makeAuthType = authType => {
    const auth = {
      authenticationType: authType.authenticationType
    };

    if (auth.authenticationType === _amplifyAppsyncSimulator.AmplifyAppSyncSimulatorAuthenticationType.AMAZON_COGNITO_USER_POOLS) {
      auth.cognitoUserPoolConfig = {
        AppIdClientRegex: authType.userPoolConfig.appIdClientRegex
      };
    } else if (auth.authenticationType === _amplifyAppsyncSimulator.AmplifyAppSyncSimulatorAuthenticationType.OPENID_CONNECT) {
      auth.openIDConnectConfig = {
        Issuer: authType.openIdConnectConfig.issuer,
        ClientId: authType.openIdConnectConfig.clientId
      };
    }

    return auth;
  };

  const makeAppSync = config => ({
    name: config.name,
    apiKey: context.options.apiKey,
    defaultAuthenticationType: makeAuthType(config),
    additionalAuthenticationProviders: (config.additionalAuthenticationProviders || []).map(makeAuthType)
  }); // Load the schema. If multiple provided, merge them


  const schemaPaths = Array.isArray(cfg.schema) ? cfg.schema : [cfg.schema || 'schema.graphql'];
  const basePath = context.serverless.config.servicePath;
  const schemas = globFilePaths(basePath, schemaPaths).map(schemaPath => getFileMap(basePath, schemaPath));
  const schema = {
    path: (0, _lodash.first)(schemas).path,
    content: (0, _mergeGraphqlSchemas.mergeTypes)(schemas.map(s => s.content))
  };
  return {
    appSync: makeAppSync(cfg),
    schema,
    resolvers: cfg.mappingTemplates.map(makeResolver),
    dataSources: cfg.dataSources.map(makeDataSource).filter(v => v !== null),
    functions: cfg.functionConfigurations.map(makeFunctionConfiguration)
  };
}