import 'zone.js';
import '@angular/compiler';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app.module';

console.log('Bootstrapping PumpSimulator...');

platformBrowserDynamic()
  .bootstrapModule(AppModule)
  .catch(err => console.error(err));
