import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { unauthorizedInterceptor } from './app/api.service';

bootstrapApplication(AppComponent, {
  providers: [provideHttpClient(withInterceptors([unauthorizedInterceptor]))],
}).catch((err) => console.error(err));
