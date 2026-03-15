import 'zone.js';
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app.component';

console.log('Bootstrapping PumpSimulator...');

bootstrapApplication(AppComponent, {
  providers: []
}).catch(err => console.error(err));
