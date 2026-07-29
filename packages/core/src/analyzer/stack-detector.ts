import type { ProjectAnalysis } from '../types.js';
import {
  readPackageJson,
  readPyprojectToml,
  readGoMod,
  readCargoToml,
  readBuildGradle,
  readGradleBuildFiles,
  readDockerCompose,
  readREADME,
} from './config-reader.js';

export async function detectStack(projectPath: string): Promise<ProjectAnalysis> {
  const analysis: ProjectAnalysis = {
    languages: [],
    frameworks: [],
    databases: [],
    runtimes: [],
    buildTools: [],
    testFrameworks: [],
  };

  // Check Node.js
  const packageJson = await readPackageJson(projectPath);
  if (packageJson) {
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    analysis.languages.push('JavaScript/TypeScript');
    analysis.runtimes.push(packageJson.type === 'module' ? 'Node.js (ESM)' : 'Node.js');

    // Detect frameworks
    if (deps.react) analysis.frameworks.push('React');
    if (deps.vue) analysis.frameworks.push('Vue');
    if (deps.angular) analysis.frameworks.push('Angular');
    if (deps.express) analysis.frameworks.push('Express');
    if (deps.fastify) analysis.frameworks.push('Fastify');
    if (deps.next) analysis.frameworks.push('Next.js');
    if (deps.nuxt) analysis.frameworks.push('Nuxt');
    if (deps.remix) analysis.frameworks.push('Remix');
    if (deps.svelte) analysis.frameworks.push('Svelte');
    if (deps.astro) analysis.frameworks.push('Astro');
    if (deps.trpc) analysis.frameworks.push('tRPC');

    // Databases
    if (deps.prisma) analysis.databases.push('Prisma');
    if (deps.typeorm) analysis.databases.push('TypeORM');
    if (deps.mongoose) analysis.databases.push('MongoDB/Mongoose');
    if (deps.sequelize) analysis.databases.push('Sequelize');
    if (deps.knex) analysis.databases.push('Knex');
    if (deps['@mikro-orm/core']) analysis.databases.push('MikroORM');

    // Testing
    if (deps.jest) analysis.testFrameworks.push('Jest');
    if (deps.vitest) analysis.testFrameworks.push('Vitest');
    if (deps.mocha) analysis.testFrameworks.push('Mocha');
    if (deps.cypress) analysis.testFrameworks.push('Cypress');
    if (deps.playwright) analysis.testFrameworks.push('Playwright');

    // Build tools
    if (deps.typescript) {
      if (!analysis.languages.includes('TypeScript')) {
        analysis.languages[0] = 'TypeScript';
      }
    }
    if (deps.vite) analysis.buildTools.push('Vite');
    if (deps.webpack) analysis.buildTools.push('Webpack');
    if (deps.esbuild) analysis.buildTools.push('esbuild');
    if (deps.parcel) analysis.buildTools.push('Parcel');
    if (deps.rollup) analysis.buildTools.push('Rollup');
  }

  // Check Python
  const pyproject = await readPyprojectToml(projectPath);
  if (pyproject) {
    analysis.languages.push('Python');
    if (pyproject.includes('django')) analysis.frameworks.push('Django');
    if (pyproject.includes('fastapi')) analysis.frameworks.push('FastAPI');
    if (pyproject.includes('flask')) analysis.frameworks.push('Flask');
    if (pyproject.includes('sqlalchemy')) analysis.databases.push('SQLAlchemy');
    if (pyproject.includes('pytest')) analysis.testFrameworks.push('pytest');
  }

  // Check Go
  const goMod = await readGoMod(projectPath);
  if (goMod) {
    analysis.languages.push('Go');
    if (goMod.includes('github.com/gin-gonic/gin')) analysis.frameworks.push('Gin');
    if (goMod.includes('github.com/labstack/echo')) analysis.frameworks.push('Echo');
    if (goMod.includes('github.com/gorilla/mux')) analysis.frameworks.push('Gorilla Mux');
    if (goMod.includes('gorm.io/gorm')) analysis.databases.push('GORM');
  }

  // Check Rust
  const cargo = await readCargoToml(projectPath);
  if (cargo) {
    analysis.languages.push('Rust');
    if (cargo.includes('actix')) analysis.frameworks.push('Actix');
    if (cargo.includes('rocket')) analysis.frameworks.push('Rocket');
    if (cargo.includes('axum')) analysis.frameworks.push('Axum');
    if (cargo.includes('tokio')) analysis.frameworks.push('Tokio');
    if (cargo.includes('diesel')) analysis.databases.push('Diesel');
    if (cargo.includes('sqlx')) analysis.databases.push('SQLx');
  }

  // Check Android/Kotlin. `readBuildGradle` (root only) is the "is this
  // even a Gradle project?" signal; the framework substring checks read
  // the root plus every depth-1 module's build file too (spec 049) — a
  // multi-module Android project's `com.android`/`androidx.compose`
  // markers commonly live in a module's build file, not the root's.
  const buildGradle = await readBuildGradle(projectPath);
  if (buildGradle) {
    if (!analysis.languages.includes('Kotlin')) {
      analysis.languages.push('Kotlin/Java');
    }
    analysis.buildTools.push('Gradle');

    const gradleBuildFiles = (await readGradleBuildFiles(projectPath)) ?? buildGradle;
    if (gradleBuildFiles.includes('com.android')) {
      analysis.frameworks.push('Android');
    }
    if (gradleBuildFiles.includes('androidx.compose')) {
      analysis.frameworks.push('Jetpack Compose');
    }
  }

  // Check Docker
  const dockerCompose = await readDockerCompose(projectPath);
  if (dockerCompose) {
    analysis.buildTools.push('Docker Compose');
  }

  // Read description from README
  const readme = await readREADME(projectPath);
  if (readme) {
    const firstLine = readme.split('\n').find(l => l.trim() && !l.startsWith('#'));
    if (firstLine) {
      analysis.description = firstLine.replace(/^#+\s*/, '').trim();
    }
  }

  // Deduplicate
  analysis.languages = [...new Set(analysis.languages)];
  analysis.frameworks = [...new Set(analysis.frameworks)];
  analysis.databases = [...new Set(analysis.databases)];
  analysis.runtimes = [...new Set(analysis.runtimes)];
  analysis.buildTools = [...new Set(analysis.buildTools)];
  analysis.testFrameworks = [...new Set(analysis.testFrameworks)];

  return analysis;
}
