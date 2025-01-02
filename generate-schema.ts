import { ConfigureGenerator } from './src/tools/generate';
import { GraphQLDefinitionsFactory } from '@nestjs/graphql';
import * as path from 'path';
import * as fs from 'fs';

const generator = new ConfigureGenerator();
const definitionsFactory = new GraphQLDefinitionsFactory();

generator.generateSubgraphSchema();
generator.generateChainManager();
generator.generateEventHandlers();

const items = fs.readdirSync('./src/.generate');
items.forEach(item => {
    if (path.extname(item) === '.graphql') {
        definitionsFactory.generate({
            typePaths: [`./src/.generate/${item}`],
            path: path.join(process.cwd(), `src/.generate/${item}.ts`),
            outputAs: 'class',
        });
    }
});

