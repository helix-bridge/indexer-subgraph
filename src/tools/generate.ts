import { Logger } from '@nestjs/common';
import { last } from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { parse } from 'graphql';

export function solidityType2TsType(solidityType: string) {
    if (solidityType.includes("uint")) {
        return "bigint";
    }
    if (solidityType == 'bytes32[]') {
        return "string[]";
    }
    if (solidityType === "address" || solidityType.includes("byte")) {
        return "string";
    }
    if (solidityType == "bool") {
        return "boolean";
    }
}

export function schemaType2TsType(schemaType: string) {
    if (schemaType === "ID" || schemaType === "String" || schemaType === "Bytes") {
        return "string";
    }
    if (schemaType === "Int") {
        return "number";
    }
    if (schemaType === "BigInt") {
        return "bigint";
    }
    if (schemaType === "Boolean") {
        return "boolean";
    }
}

interface Import {
    from: string;
    interfaces: string[];
}

interface Processor {
    functionName: string;
    cases: string[];
}

interface SubgraphHandle {
    prefix: string;
    imports: Import[];
    processor: Processor;
}

interface Subgraph {
    name: string;
    handlers: SubgraphHandle[];
}

interface ContractEvent {
    event: string;
    hasReceipt: boolean;
    hasTimestamp: boolean;
}

interface ContractConf {
    subgraph: string;
    name: string;
    address: string;
    prefix: string;
    events: ContractEvent[];
}

interface NetworkConf {
    chainId: bigint;
    chainName: string;
    urls: string[];
    minStartBlock: number;
    minScanRange: number;
    maxReorg: number;
    scanInterval: number;
    rewrite: boolean;
    contracts: ContractConf[];
}

export class ConfigureGenerator {
  private readonly logger = new Logger("generater");
  private filePath = path.join(__dirname, 'subgraph.graphql');
  private subgraphDir = path.join(__dirname, '../subgraph');
  private schema: string = "";
  private subgraphs: Subgraph[] = [];
  private networks: NetworkConf[] = [];

  readFile(filePath: string): string {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return data;
    } catch (error) {
        console.error('Error reading configure file:', error);
        return null;
    }
  }

  writeFile(filePath: string, data: string): void {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, data, 'utf8');
    } catch (error) {
        console.error('Error writing file:', error);
    }
  }

  // using subgraphName to seperate db table
  readSchema(data: string) {
      this.schema += data;
  }

  generatePrisma(): string {
      const header = `generator client {\n  provider = "prisma-client-js"\n  binaryTargets = ["native", "linux-musl"]\n  previewFeatures = ["fullTextSearch"]\n}\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n`;
      const replaces = [
          {_1: "type ", _2: "model "},
          {_1: "!", _2: ""},
          {_1: "ID", _2: "String @id"},
          {_1: ": ", _2: " "},
          {_1: ":", _2: " "},
          // the max value of BigInt in postgres is 64bit
          //{_1: "BigInt", _2: "String"},
      ];
      let schema: string = this.schema;
      for (const replace of replaces) {
          schema = schema.split(replace._1).join(replace._2);
      }
      schema += `model LastBlock {\n  id String @id\n  blockNumber BigInt\n  scanedEvent BigInt\n}\n`;
      return header + schema;
  }

  generateSubgraphSchema(): void {
      try {
          const items = fs.readdirSync(this.subgraphDir);
          let importSubgraphModule = "";
          let subgraphModules = "";
          items.forEach(item => {
              const fullPath = path.join(this.subgraphDir, item);
              const statsDir = fs.statSync(fullPath);
              if (statsDir.isDirectory()) {
                  const yamlPath = path.join(fullPath, "config.yaml");
                  const yamlFile = fs.statSync(yamlPath);
                  if (!yamlFile.isFile()) {
                      return;
                  }
                  const yamlContent = this.readFile(yamlPath);
                  const enabled = this.parseYaml(fullPath, yamlContent, item);
                  if (!enabled) {
                      return;
                  }
                  const schemaPath = path.join(fullPath, "schema.graphql");
                  const statsFile = fs.statSync(schemaPath);
                  if (statsFile.isFile()) {
                      let schema = this.readFile(schemaPath);
                      if (schema !== null) {
                          schema = schema.split("Bytes").join("String").split(" @entity").join("");
                          const subgraphBigName = item.charAt(0).toUpperCase() + item.slice(1);
                          const schemaWithPrefix = schema.split("type ").join("type " + subgraphBigName);
                          this.readSchema(schemaWithPrefix);
                          const schemaCodePath = path.join(fullPath, "generated", "schema.ts");
                          this.generateSchemaType(item, schema, schemaCodePath);
                          const schemaData = "scalar BigInt\nscalar ID\n" + schemaWithPrefix.split("?").join("") + this.generateSchemaQueryMethods(item, schema);
                          this.writeFile(`./src/.generate/${item}.schema.graphql`, schemaData);
                          this.generateSchemaQueryMethodResolvers(item, schema);
                          this.generateSchemaQueryMethodServices(item, schema);
                          importSubgraphModule += `import {${subgraphBigName}Module} from './${item}.module'\n`;
                          subgraphModules += `    ${subgraphBigName}Module,\n`;
                      }
                  }
              }
          });
          const prismaData = this.generatePrisma();
          this.writeFile('./src/.generate/index.schema.prisma', prismaData);
          let subgraphModule = `import { Module } from '@nestjs/common';\n` + importSubgraphModule;
          subgraphModule += "@Module({\n  imports: [\n" + subgraphModules + "  ],\n})\nexport class SubgraphModule {}\n"
          this.writeFile('./src/.generate/subgraph.module.ts', subgraphModule);
      } catch(err) {
          this.logger.error(`generate subgraph schema failed, err ${err}`);
      }
  }

  generateSchemaType(subgraphName: string, schema: string, outPath: string): void {
      const schemaContent = parse(schema.split("?").join(""));
      let schemaCode = `import { prismaClientGlobal } from "../../../events/scan";\n`;
      schemaCode += `\nexport class Entity {\n  private data: Map<string, string | bigint | number | boolean | string[]> = new Map();\n  set(key: string, value: string | bigint | number | boolean | string[]): void {\n    this.data.set(key, value);\n  }\n  get(key: string): string | bigint | number | boolean | string[] | null {\n    return this.data.get(key);\n  }\n }\n`;
      const template = this.readFile("./src/tools/schema.template");
      for (const definition of schemaContent.definitions) {
          let entityName = definition['name'].value;
          let entityPrismaLowerCase = subgraphName + entityName;
          let newEntity = template.split("TEMPLATE_PRISMA").join(entityPrismaLowerCase);
          newEntity = newEntity.split("TEMPLATE").join(entityName);
          const fields = definition['fields'];
          let methods = "";
          let fieldsInit = "";
          let fieldsAssign = "";
          for (const field of fields) {
              const methodName = field['name'].value;
              const fieldType = field.type?.name?.value ?? field.type.type.name.value;
              const fieldTsType = schemaType2TsType(fieldType);
              if (fieldTsType === undefined) {
                  throw new Error(`can't convert schema type ${fieldType}`);
              }
              methods += `\n  get ${methodName}(): ${fieldTsType} {\n    return this.get("${methodName}") as ${fieldTsType};\n  }\n`;
              methods += `\n  set ${methodName}(value: ${fieldTsType}) {\n    this.set("${methodName}", value);\n  }\n`;
              //const valueInit = fieldType === 'BigInt' ? `this.${methodName}?.toString() ?? "0"` : `this.${methodName}`;
              //const valueAssign = fieldType === 'BigInt' ? `BigInt(record.${methodName})` : `record.${methodName}`;
              const valueInit = `this.${methodName}`;
              const valueAssign = `record.${methodName}`;
              fieldsInit += "\n" + ' '.repeat(16) + `${methodName}: ${valueInit},`;
              fieldsAssign += "\n" + ' '.repeat(6) + `result.${methodName} = ${valueAssign};`;
          }
          newEntity = newEntity.split("//FieldsInit").join(fieldsInit);
          newEntity = newEntity.replace("//FieldsAssign", fieldsAssign);
          schemaCode += newEntity.replace("//getOrSetMethods", methods);
      }
      this.writeFile(outPath, schemaCode);
  }

  parseYaml(fullPath: string, fileContents: string, subgraphDir: string): boolean {
      const data = yaml.load(fileContents);
      if (data.disable) {
          return false;
      }
      let eventWithABIMap = new Map();
      let eventHandlers = [];
      // if the same handler file include duplicate events, throw error
      let handler2Events = new Map();
      let contractMap = new Map();
      for (const contract of data.contracts) {
          const events = contract.events.map(e => {
              return {
                  event: e.event,
                  hasReceipt: e.receipt,
                  hasTimestamp: e.timestamp,
              };
          });
          const name = data.name + "." + contract.name + ".ts";
          const eventWithABIs = this.generateEventFromABI(
              name,
              events,
              path.join(fullPath, contract.abi_file_path),
              path.join(fullPath, "generated", name)
          );
          const eventHandler = this.generateEventHandler(name, contract.name, contract.handler, events.map(e => e.event), subgraphDir);
          eventHandlers.push(eventHandler);
          eventWithABIMap.set(contract.name, eventWithABIs);
          let handler2Event = handler2Events.get(contract.handler);
          if (!handler2Event) {
              handler2Events.set(contract.handler, events.map(e => e.event));
          } else {
              handler2Event.push(...events.map(e => e.event));
          }
          contractMap.set(contract.name, eventHandler.prefix);
      }

      const fundDuplicates = (arr: string[]) => {
          const elementCount: { [key: string]: number } = {};
          const duplicates: any[] = [];
          for (const item of arr) {
              if (elementCount[item]) {
                  elementCount[item]++;
              } else {
                  elementCount[item] = 1;
              }
          }
          for (const key in elementCount) {
              if (elementCount[key] > 1) {
                  duplicates.push(key);
              }
          }
          return duplicates;
      };
      for (const [handler, handler2Event] of handler2Events) {
          const duplicate = fundDuplicates(handler2Event);
          if (duplicate.length > 0) {
              throw new Error(`same event ${duplicate} in different contracts with same handler ${handler}`);
          }
      }
      this.subgraphs.push({
          name: subgraphDir,
          handlers: eventHandlers,
      });
      // merge allnetworks and contracts
      for (const network of data.networks) {
          if (network.disable) continue;
          let existNetwork = this.networks.find(n => n.chainId === network.id);
          if (existNetwork === undefined) {
              existNetwork = {
                  chainId: network.id,
                  chainName: network.name,
                  urls: network.urls.map(u => u.url),
                  minStartBlock: network.start_block,
                  minScanRange: network.scan_range,
                  maxReorg: network.reorg ?? 0,
                  scanInterval: network.scan_interval,
                  rewrite: network.rewrite,
                  contracts: [],
              };
              this.networks.push(existNetwork);
          } else {
              existNetwork.urls.concat(network.urls.map(u => u.url));
              existNetwork.minScanRange < network.scan_range ? existNetwork.minScanRange : network.scan_range;
              existNetwork.maxReorg >= (network.reorg ?? 0) ? existNetwork.maxReorg : network.reorg;
              existNetwork.scanInterval < network.scan_interval ? existNetwork.scanInterval : network.scan_interval;
              if (network.rewrite) {
                  if (!existNetwork.rewrite) {
                      existNetwork.minStartBlock = network.start_block;
                  } else {
                      existNetwork.minStartBlock < network.start_block ? existNetwork.minStartBlock : network.start_block;
                  }
                  existNetwork.rewrite = network.rewrite;
              }
              if (!existNetwork.rewrite) {
                  existNetwork.minStartBlock < network.start_block ? existNetwork.minStartBlock : network.start_block;
              }
          }
          for (const contract of network.contracts) {
              let contractConf = contractMap.get(contract.name);
              if (!contractConf) {
                  throw new Error(`contract not configured ${contract.name}`);
              }
              existNetwork.contracts.push({
                  subgraph: subgraphDir,
                  name: contract.name,
                  prefix: contractConf,
                  address: contract.address,
                  events: eventWithABIMap.get(contract.name),
              });
          }
      }
      return true;
  }

  // parse ABI
  // return events
  generateEventFromABI(name: string, events: ContractEvent[], abiPath: string, outPath: string): string[] {
      let eventWithABIs = [];
      let eventABIs = events.map((e) => e.event);
      const abi = this.readFile(abiPath);
      const abiObjects = JSON.parse(abi).filter(a => a.type === 'event' && eventABIs.includes(a.name));
      const template = this.readFile("./src/tools/event.template");
      //let eventCodes = this.readFile("./src/tools/event.base.ts");
      let eventCodes = `import { Transaction, EventParam, Event } from "../../../events/event.base";\n`;
      for (const abiObj of abiObjects) {
          let eventWithABI = `event ${abiObj.name}(`;
          let newEntity = template.split("TEMPLATE").join(abiObj.name);
          let methods = "";
          let index = 0;
          for (const input of abiObj.inputs) {
              if (input.type === 'tuple') {
                  eventWithABI += "(";
                  let subIndex = 0;
                  for (const component of input.components) {
                      eventWithABI += `${component.type},`;
                      const tsType = solidityType2TsType(component.type);
                      if (tsType === undefined) {
                          throw new Error(`can't convert solidity type ${component.type}`);
                      }
                      methods += `\n  get ${component.name}(): ${tsType} {\n    return this._event.parameters[${index}].value[${subIndex}] as ${tsType};\n  }\n`;
                      subIndex++;
                  }
                  index++;
                  eventWithABI = eventWithABI.slice(0, -1) + "),";
              } else {
                  const indexed = input.indexed ? " indexed" : "";
                  eventWithABI += `${input.type}${indexed},`;
                  const tsType = solidityType2TsType(input.type);
                  if (tsType === undefined) {
                      throw new Error(`can't convert solidity type ${input.type}`);
                  }
                  methods += `\n  get ${input.name}(): ${tsType} {\n    return this._event.parameters[${index}].value as ${tsType};\n  }\n`;
                  index++;
              }
          }
          eventWithABI = eventWithABI.slice(0, -1) + ")";
          const event = events.find(e => e.event == abiObj.name);
          eventWithABIs.push({
              event: eventWithABI,
              hasReceipt: event.hasReceipt,
              hasTimestamp: event.hasTimestamp,
          });
          eventCodes += newEntity.replace("//getOrSetMethods", methods);
      }
      this.writeFile(outPath, eventCodes);
      return eventWithABIs;
  }

  generateEventHandler(
      name: string,
      contractName: string,
      handlerFile: string,
      events: string[],
      subgraphDir: string,
  ) {
      const handlerName = last(handlerFile.replace(".ts", "").split("/"));
      const prefix = `${subgraphDir}_${handlerName}`;

      let imports = [
          {
              from: `../../subgraph/${subgraphDir}/${handlerFile.replace(".ts", "").replace("./", "")}`,
              interfaces: [],
          },
          {
              from: `../../subgraph/${subgraphDir}/generated/${name.replace(".ts", "")}`,
              interfaces: [],
          },
      ];

      for (const event of events) {
          imports[0].interfaces.push(`handle${event} as ${prefix}_handle${event}`);
          imports[1].interfaces.push(`${event} as ${subgraphDir}_${contractName}_${event}`);
      }

      const cases = events.map( e => {
          return `    case '${e}':\n` +
                 `      const _${e}: ${subgraphDir}_${contractName}_${e} = new ${subgraphDir}_${contractName}_${e}(context, event.tx, event.blockTimestamp, eventParams);\n` +
                 `      await ${prefix}_handle${e}(_${e});\n` +
                 `      return;\n`
      });

      let processor = {
          functionName: `export async function ${prefix}_handleEvent(event: EventData, context: EventContext) {\n`,
          cases: cases,
      };

      return {prefix, imports, processor};
  }


  // input WhereInput {
  //   sender: String
  //   receiver: String
  //   sender_gt: String
  //   sender_lt: String
  // }
  // type Query {
  //   historyRecords(where: WhereInput): [HistoryRecord]
  // }
  generateSchemaQueryMethods(subgraphName: string, schema: string): string {
      const schemaContent = parse(schema.split("?").join(""));
      let orderDirectionEnum = `\nenum OrderDirection {\n  asc\n  desc\n}\n`;
      let orderBys = "\n";
      let inputs = "\n";
      let queryFunctions = "type Query {\n";
      let innerChainData = `type InnerChainData {\n`;
      innerChainData += `  chainId: BigInt\n  name: String\n  scanedBlock: Int\n  latestBlock: Int\n  scanedEvent: Int\n}`;
      queryFunctions += `  chainData(id: Int): [InnerChainData]\n`;
      for (const definition of schemaContent.definitions) {
          let entityName = definition['name'].value;
          let entityPrismaLowerCase = subgraphName + entityName;
          let entityPrismaUpperCase = subgraphName.charAt(0).toUpperCase() + subgraphName.slice(1) + entityName;
          let entityNameFirstLowerCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);
          const fields = definition['fields'];
          let orderBy = `enum OrderBy${entityPrismaUpperCase} {\n`;
          let inputWhereInterface = `input WhereInput${entityPrismaUpperCase} {\n`;
          for (const field of fields) {
              const fieldName = field['name'].value;
              const fieldType = field.type?.name?.value ?? field.type.type.name.value;
              inputWhereInterface += `  ${fieldName}: ${fieldType}\n`;
              inputWhereInterface += `  ${fieldName}_gt: ${fieldType}\n`;
              inputWhereInterface += `  ${fieldName}_lt: ${fieldType}\n`;
              inputWhereInterface += `  ${fieldName}_in: [${fieldType}]\n`;
              inputWhereInterface += `  ${fieldName}_not: ${fieldType}\n`;
              inputWhereInterface += `  ${fieldName}_gte: ${fieldType}\n`;
              inputWhereInterface += `  ${fieldName}_lte: ${fieldType}\n`;
              inputWhereInterface += `  ${fieldName}_not_in: [${fieldType}]\n`;
              inputWhereInterface += `  ${fieldName}_contains: ${fieldType}\n`;
              inputWhereInterface += `  ${fieldName}_not_contains: ${fieldType}\n`;
              orderBy += `  ${fieldName}\n`;
          }
          inputWhereInterface += "}\n";
          orderBy += "}\n";
          inputs += inputWhereInterface;
          orderBys += orderBy;
          queryFunctions += `  ${entityNameFirstLowerCase}s(`;
          queryFunctions += `first: Int, skip: Int, `;
          queryFunctions += `where: WhereInput${entityPrismaUpperCase}, `;
          queryFunctions += `orderDirection: OrderDirection, orderBy: OrderBy${entityPrismaUpperCase}`;
          queryFunctions += `): [${entityPrismaUpperCase}]\n`;
          // uniqueQuery
          queryFunctions += `  ${entityNameFirstLowerCase}(id: ID): ${entityPrismaUpperCase}\n`;
      }
      queryFunctions += "}";
      return orderDirectionEnum + orderBys + innerChainData + inputs + queryFunctions;
  }

  generateSchemaQueryMethodResolvers(subgraphName, schema): void {
      const schemaContent = parse(schema.split("?").join(""));
      let importGraphql = "import {\n  OrderDirection,\n";
      let queryFunctions = "\n";

      for (const definition of schemaContent.definitions) {
          let queryFunction = "  @Query()\n";
          let uniqueQueryFunction = "  @Query()\n";

          let entityName = definition['name'].value;
          let entityNameFirstLowerCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);
          let entityPrismaLowerCase = subgraphName + entityName;
          let entityPrismaUpperCase = subgraphName.charAt(0).toUpperCase() + subgraphName.slice(1) + entityName;
          importGraphql += `  WhereInput${entityPrismaUpperCase},\n`;
          importGraphql += `  OrderBy${entityPrismaUpperCase},\n`;
          importGraphql += `  ${entityPrismaUpperCase},\n`;
          queryFunction += `  async ${entityNameFirstLowerCase}s(\n`;
          queryFunction += `    @Args('first') first: number,\n`;
          queryFunction += `    @Args('skip') skip: number,\n`;
          queryFunction += `    @Args('orderDirection') orderDirection: OrderDirection,\n`;
          queryFunction += `    @Args('orderBy') orderBy: OrderBy${entityPrismaUpperCase},\n`;
          queryFunction += `    @Args('where') where: WhereInput${entityPrismaUpperCase},\n`;
          queryFunction += `  ): Promise<${entityPrismaUpperCase}[]> {\n`;
          queryFunction += `    const orderDirectionPrisma = orderDirection === OrderDirection.asc ? Prisma.SortOrder.asc : Prisma.SortOrder.desc;\n    const orderByPrisma = orderBy === undefined ? {} : {\n      [orderBy]: orderDirectionPrisma,\n    };\n    let whereConditions = {};\n`;

          const fields = definition['fields'];
          for (const field of fields) {
              const fieldName = field['name'].value;
              const fieldType = field.type?.name?.value ?? field.type.type.name.value;
              queryFunction += `    if (where?.${fieldName}) {\n`;
              queryFunction += `      whereConditions['${fieldName}'] = where.${fieldName}\n`;
              queryFunction += `    } else if (where?.${fieldName}_gt) {\n`;
              queryFunction += `      whereConditions['${fieldName}'] = {\n`;
              queryFunction += `        gt: where.${fieldName}_gt\n`;
              queryFunction += `      }\n`;
              queryFunction += `    } else if (where?.${fieldName}_lt) {\n`;
              queryFunction += `      whereConditions['${fieldName}'] = {\n`;
              queryFunction += `        lt: where.${fieldName}_lt\n`;
              queryFunction += `      }\n`;
              queryFunction += `    } else if (where?.${fieldName}_in) {\n`;
              queryFunction += `      whereConditions['${fieldName}'] = {\n`;
              queryFunction += `        in: where.${fieldName}_in\n`;
              queryFunction += `      }\n`;
              queryFunction += `    } else if (where?.${fieldName}_not) {\n`;
              queryFunction += `      whereConditions['${fieldName}'] = {\n`;
              queryFunction += `        not: where.${fieldName}_not\n`;
              queryFunction += `      }\n`;
              queryFunction += `    } else if (where?.${fieldName}_gte) {\n`;
              queryFunction += `      whereConditions['${fieldName}'] = {\n`;
              queryFunction += `        gte: where.${fieldName}_gte\n`;
              queryFunction += `      }\n`;
              queryFunction += `    } else if (where?.${fieldName}_lte) {\n`;
              queryFunction += `      whereConditions['${fieldName}'] = {\n`;
              queryFunction += `        lte: where.${fieldName}_lte\n`;
              queryFunction += `      }\n`;
              queryFunction += `    } else if (where?.${fieldName}_not_in) {\n`;
              queryFunction += `      whereConditions['${fieldName}'] = {\n`;
              queryFunction += `        not: { in: where.${fieldName}_not_in }\n`;
              queryFunction += `      }\n`;
              queryFunction += `    } else if (where?.${fieldName}_contains) {\n`;
              queryFunction += `      whereConditions['${fieldName}'] = {\n`;
              queryFunction += `        contains: where.${fieldName}_contains\n`;
              queryFunction += `      }\n`;
              queryFunction += `    } else if (where?.${fieldName}_not_contains) {\n`;
              queryFunction += `      whereConditions['${fieldName}'] = {\n`;
              queryFunction += `        not: { contains: where.${fieldName}_not_contains }\n`;
              queryFunction += `      }\n    }\n`;
          }
          queryFunction += `    const wherePrisma = { AND: whereConditions };\n`;
          queryFunction += `    return this.generateService.${entityNameFirstLowerCase}s({\n`;
          queryFunction += `      take: first,\n      skip: skip,\n      where: wherePrisma,\n      orderBy:orderByPrisma,\n    });\n  }\n`;
          uniqueQueryFunction += `  async ${entityNameFirstLowerCase}(\n`;
          uniqueQueryFunction += `    @Args('id') id: string,\n`;
          uniqueQueryFunction += `  ): Promise<${entityPrismaUpperCase}> {\n`;
          uniqueQueryFunction += `    return await this.generateService.${entityNameFirstLowerCase}({ id: id });\n  }\n`;
          queryFunctions += "\n" + queryFunction + "\n" + uniqueQueryFunction;
      }
      importGraphql += `} from './${subgraphName}.schema.graphql';`;
      const subgraphBigName = subgraphName.charAt(0).toUpperCase() + subgraphName.slice(1);
      const resolverTemplate = this.readFile("./src/tools/generate.resolver.template");
      const generateResolveCodes = resolverTemplate.replace(/#ImportGraphql#/g, importGraphql).replace(/#QueryMethods#/g, queryFunctions).replace(/#Generate#/g, subgraphBigName).replace(/#generate#/g, subgraphName);
      this.writeFile(`./src/.generate/${subgraphName}.resolver.ts`, generateResolveCodes);
      const templateModule = this.readFile("./src/tools/generate.module.template");
      const generateModuleCodes = templateModule.replace(/#Generate#/g, subgraphBigName).replace(/#generate#/g, subgraphName);
      this.writeFile(`./src/.generate/${subgraphName}.module.ts`, generateModuleCodes);
  }

  generateSchemaQueryMethodServices(subgraphName, schema): void {
      const schemaContent = parse(schema.split("?").join(""));
      let importGraphql = "import {\n";
      let queryFunctions = "\n";
      for (const definition of schemaContent.definitions) {
          let entityName = definition['name'].value;
          let entityNameFirstLowerCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);
          let entityPrismaLowerCase = subgraphName + entityName;
          let entityPrismaUpperCase = subgraphName.charAt(0).toUpperCase() + subgraphName.slice(1) + entityName;
          importGraphql += `  ${entityPrismaUpperCase},\n`;
          let uniqueQueryFunction = `  async ${entityNameFirstLowerCase}(\n`;
          uniqueQueryFunction += `    data: Prisma.${entityPrismaUpperCase}WhereUniqueInput\n`;
          uniqueQueryFunction += `  ): Promise<${entityPrismaUpperCase}> {\n`;
          uniqueQueryFunction += `    return await prismaClientGlobal.${entityPrismaLowerCase}.findUnique({\n`;
          uniqueQueryFunction += `      where: data,\n    });\n}\n`;
          let queryFunction = `  async ${entityNameFirstLowerCase}s(params: {\n`;
          queryFunction += `    skip?: number;\n`;
          queryFunction += `    take?: number;\n`;
          queryFunction += `    where?: Prisma.${entityPrismaUpperCase}WhereInput;\n`;
          queryFunction += `    orderBy?: Prisma.Enumerable<Prisma.${entityPrismaUpperCase}OrderByWithRelationAndSearchRelevanceInput>;\n`;
          queryFunction += `  }): Promise<${entityPrismaUpperCase}[]> {\n`;
          queryFunction += `    const { skip, take, where, orderBy } = params;\n`;
          queryFunction += `    const records = await prismaClientGlobal.${entityPrismaLowerCase}.findMany({\n`;
          queryFunction += `      skip,\n      take,\n      where,\n      orderBy,\n    });\n`;
          queryFunction += `    return records;\n  }\n`;
          queryFunctions += "\n" + queryFunction;
          queryFunctions += "\n" + uniqueQueryFunction;
      }
      importGraphql += `} from './${subgraphName}.schema.graphql';`;
      const subgraphBigName = subgraphName.charAt(0).toUpperCase() + subgraphName.slice(1);
      const template = this.readFile("./src/tools/generate.service.template");
      const generateServiceCodes = template.replace(/#ImportGraphql#/g, importGraphql).replace(/#QueryMethods#/g, queryFunctions).replace(/#Generate#/g, subgraphBigName);
      this.writeFile(`./src/.generate/${subgraphName}.service.ts`, generateServiceCodes);
  }

  // need merge import if same
  generateEventHandlers(): void {
     let importHandler = `import { EventParam, EventContext } from "../../events/event.base";\n`
     importHandler += `import { EventData } from "../../events/scan";\n`;
     
     let mergedImports: Import[] = [];
     let mergedProcessors: Processor[] = [];
     for (const subgraph of this.subgraphs) {
         for (const eventHandler of subgraph.handlers) {
             for (const it of eventHandler.imports) {
                 const mergedImport = mergedImports.find((e) => e.from === it.from);
                 if (!mergedImport) {
                     mergedImports.push(it);
                 } else {
                     mergedImport.interfaces.push(...it.interfaces);
                 }
             }
             const mergedProcessor = mergedProcessors.find((e) => e.functionName === eventHandler.processor.functionName);
             if (!mergedProcessor) {
                 mergedProcessors.push(eventHandler.processor);
             } else {
                 mergedProcessor.cases.push(...eventHandler.processor.cases);
             }
         }
     }

     let body = "";
     for (const mergedImport of mergedImports) {
         importHandler += "import {\n";
         importHandler += `  ${Array.from(new Set(mergedImport.interfaces)).join(",\n  ")}`;
         importHandler += `\n} from "${mergedImport.from}";\n\n`;
     }
     for (const mergedProcessor of mergedProcessors) {
         body += `${mergedProcessor.functionName}`;
         body += "  let eventParams: EventParam[] = event.args.map(e => {\n";
         body += `    return { type: typeof e.value, value: e.value };\n`;
         body += "  });\n";
         body += "  switch (event.name) {\n";
         body += `${Array.from(new Set(mergedProcessor.cases)).join("")}`;
         body += "  }\n";
         body += "}\n";
     }
     this.writeFile("./src/.generate/src/event.handler.ts", importHandler + body);
  }

  generateChainManager(): void {
      let codes = "import { ScanLogs } from '../../events/scan';\nimport {\n";
      for (const subgraph of this.subgraphs) {
          const prefixes = subgraph.handlers.map(h => h.prefix);
          for (const prefix of Array.from(new Set(prefixes))) {
              codes += `  ${prefix}_handleEvent,\n`;
          }
      }
      codes += "} from '../../.generate/src/event.handler';\n\n";

      codes += "export class ChainManager {\n";
      codes += "  public scaners: ScanLogs[] = [];\n";
      codes += "  constructor() {\n";
      for (const network of this.networks) {
          codes += `    const scan_${network.chainId} = new ScanLogs(["${network.urls.join('","')}"], ${network.minStartBlock}, ${network.minScanRange}, ${network.chainId}, "${network.chainName}", ${network.scanInterval}, ${network.maxReorg}, ${network.rewrite});\n`;

          for (const contract of network.contracts) {
              codes += `    scan_${network.chainId}.addEventHandler(\n`;
              codes += `      "${contract.subgraph}",\n`;
              codes += `      "${contract.address}",\n`;
              codes += `      [\n`;
              for (const event of contract.events) {
                codes += `        {abi: "${event.event}", hasReceipt: ${!!event.hasReceipt}, hasTimestamp: ${!!event.hasTimestamp}},\n`;
              }
              codes += `      ],\n`;
              codes += `      ${contract.prefix}_handleEvent\n`;
              codes += `    );\n`;
          }
          codes += `    this.scaners.push(scan_${network.chainId});\n\n`;
      }
      codes += "  }\n";
      codes += "  scanData(id: number) {\n"
      codes += "    return this.scaners.map( s => {\n";
      codes += "      return {\n";
      codes += "        chainId: s.chainId,\n";
      codes += "        name: s.name,\n";
      codes += "        scanedBlock: s.lastScannedBlock,\n";
      codes += "        latestBlock: s.cacheLatestBlock,\n";
      codes += "        scanedEvent: s.scanedEventCount\n";
      codes += "      };\n";
      codes += "    })\n";
      codes += "  }\n";
      codes += "}\n";
      this.writeFile("./src/.generate/src/event.chain.ts", codes);
  }
}

